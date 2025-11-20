import { createSpinner } from 'nanospinner';
import { cursorTo, moveCursor } from 'node:readline';
import { theme, icons } from './theme.js';
import { formatRichContent, renderMessagePanel } from './richText.js';
import { getTerminalColumns, wrapPreformatted } from './layout.js';
import type { ProviderUsage } from '../core/types.js';
import { renderCallout, renderSectionHeading } from './designSystem.js';

type WriteFn = typeof process.stdout.write;
type WriteChunk = string | Uint8Array;
type WriteEncoding = BufferEncoding | undefined;

/**
 * Tracks line output to stdout for banner rewriting and cursor positioning.
 * Singleton pattern ensures consistent tracking across the application.
 */
class StdoutLineTracker {
  private static instance: StdoutLineTracker | null = null;

  static getInstance(): StdoutLineTracker {
    if (!StdoutLineTracker.instance) {
      StdoutLineTracker.instance = new StdoutLineTracker(process.stdout);
    }
    return StdoutLineTracker.instance;
  }

  private linesWritten = 0;
  private suspended = false;
  private readonly stream: NodeJS.WriteStream;
  private readonly originalWrite: WriteFn;

  private constructor(stream: NodeJS.WriteStream) {
    this.stream = stream;
    this.originalWrite = stream.write.bind(stream);
    this.patchStream();
  }

  get totalLines(): number {
    return this.linesWritten;
  }

  /**
   * Temporarily suspends line tracking while executing a function.
   * Useful for rewriting content without incrementing line count.
   */
  withSuspended<T>(fn: () => T): T {
    const wasSuspended = this.suspended;
    this.suspended = true;
    try {
      return fn();
    } finally {
      this.suspended = wasSuspended;
    }
  }

  reset(): void {
    this.linesWritten = 0;
  }

  private patchStream(): void {
    const tracker = this;
    this.stream.write = function patched(
      this: NodeJS.WriteStream,
      chunk: WriteChunk,
      encoding?: WriteEncoding | ((error: Error | null | undefined) => void),
      callback?: (error: Error | null | undefined) => void
    ): boolean {
      const actualEncoding = typeof encoding === 'function' ? undefined : encoding;
      tracker.recordChunk(chunk, actualEncoding);
      return tracker.originalWrite.call(this, chunk, encoding as WriteEncoding, callback);
    } as WriteFn;
  }

  private recordChunk(chunk: WriteChunk, encoding?: WriteEncoding): void {
    if (this.suspended) {
      return;
    }
    const text = this.chunkToString(chunk, encoding);
    if (!text) {
      return;
    }
    this.countNewlines(text);
  }

  private countNewlines(text: string): void {
    for (const char of text) {
      if (char === '\n') {
        this.linesWritten += 1;
      }
    }
  }

  private chunkToString(chunk: WriteChunk, encoding?: WriteEncoding): string | null {
    if (typeof chunk === 'string') {
      return chunk;
    }
    if (chunk instanceof Uint8Array) {
      const enc = encoding ?? 'utf8';
      return Buffer.from(chunk).toString(enc);
    }
    return null;
  }
}

interface BannerState {
  startLine: number;
  height: number;
  width: number;
  workingDir: string;
  version?: string;
  model: string;
  provider: string;
  profileLabel: string;
  profileName: string;
}

export interface DisplayMessageMetadata {
  isFinal?: boolean;
  elapsedMs?: number;
  usage?: ProviderUsage | null;
  contextWindowTokens?: number | null;
}

interface ThoughtFormatConfig {
  totalWidth: number;
  prefixWidth: number;
  available: number;
  bullet: string;
  branch: string;
  last: string;
  spacer: string;
}

type ActionStatus = 'pending' | 'success' | 'error' | 'info' | 'warning';

interface PrefixWrapOptions {
  continuationPrefix?: string;
}

interface InfoBlockStyleOptions {
  labelColor?: (value: string) => string;
  valueColor?: (value: string) => string;
}

type InfoField = 'agent' | 'profile' | 'model' | 'workspace';

interface OutputInterceptor {
  beforeWrite?: () => void;
  afterWrite?: () => void;
}

interface WordAppendResult {
  shouldFlush: boolean;
  newCurrent: string;
  chunks: string[];
}

// Display configuration constants
const DISPLAY_CONSTANTS = {
  MIN_BANNER_WIDTH: 32,
  MAX_BANNER_WIDTH: 120,
  BANNER_PADDING: 4,
  MIN_MESSAGE_WIDTH: 42,
  MAX_MESSAGE_WIDTH: 110,
  MESSAGE_PADDING: 4,
  MIN_ACTION_WIDTH: 40,
  MAX_ACTION_WIDTH: 90,
  MIN_THOUGHT_WIDTH: 48,
  MAX_THOUGHT_WIDTH: 96,
  MIN_CONTENT_WIDTH: 10,
  MIN_WRAP_WIDTH: 12,
  SPINNER_INTERVAL: 80,
} as const;

const SPINNER_FRAMES = ['∴', 'ε', '∴', '✻', 'ε', '✻'] as const;

/**
 * Display class manages all terminal UI output for the application.
 *
 * Architecture:
 * - Singleton pattern via StdoutLineTracker for consistent line tracking
 * - Output interceptor pattern for live update integration
 * - Banner state management for in-place updates
 * - Configurable width constraints via DISPLAY_CONSTANTS
 *
 * Claude Code Style Formatting:
 * - ⏺ prefix for tool calls, actions, and thinking/reasoning
 * - ⎿ prefix for results, details, and nested information
 * - ─ horizontal separators for dividing sections (edit diffs, etc.)
 * - > prefix for user prompts (handled in theme.ts formatUserPrompt)
 * - Compact epsilon spinner: ∴, ε, ✻
 *
 * Key responsibilities:
 * - Welcome banners and session information display
 * - Message formatting (assistant, system, errors, warnings)
 * - Spinner/thinking indicators
 * - Action and sub-action formatting with tree-style prefixes
 * - Text wrapping and layout management
 *
 * Error handling:
 * - Graceful degradation for non-TTY environments
 * - Input validation on public methods
 * - Safe cursor manipulation with fallback
 */
export class Display {
  private readonly stdoutTracker = StdoutLineTracker.getInstance();
  private activeSpinner: ReturnType<typeof createSpinner> | null = null;
  private readonly outputInterceptors = new Set<OutputInterceptor>();

  registerOutputInterceptor(interceptor: OutputInterceptor): () => void {
    if (!interceptor) {
      return () => {};
    }
    this.outputInterceptors.add(interceptor);
    return () => {
      this.outputInterceptors.delete(interceptor);
    };
  }

  private withOutput<T>(fn: () => T): T {
    this.notifyBeforeOutput();
    try {
      return fn();
    } finally {
      this.notifyAfterOutput();
    }
  }

  private notifyBeforeOutput(): void {
    for (const interceptor of this.outputInterceptors) {
      interceptor.beforeWrite?.();
    }
  }

  private notifyAfterOutput(): void {
    const interceptors = Array.from(this.outputInterceptors);
    for (let index = interceptors.length - 1; index >= 0; index -= 1) {
      interceptors[index]?.afterWrite?.();
    }
  }
  private bannerState: BannerState | null = null;

  /**
   * Displays the welcome banner with session information.
   * Stores banner state for potential in-place updates.
   */
  showWelcome(
    profileLabel: string,
    profileName: string,
    model: string,
    provider: string,
    workingDir: string,
    version?: string
  ) {
    // Validate required inputs
    if (!model?.trim() || !provider?.trim() || !workingDir?.trim()) {
      return;
    }

    const width = this.getBannerWidth();
    const banner = this.buildClaudeStyleBanner(
      profileLabel ?? '',
      model,
      provider,
      workingDir,
      width
    );

    if (!banner) {
      return;
    }

    const startLine = this.stdoutTracker.totalLines;
    this.withOutput(() => {
      console.log(banner);
    });

    const nextState: BannerState = {
      startLine,
      height: this.measureBannerHeight(banner),
      width,
      workingDir,
      model,
      provider,
      profileLabel: profileLabel ?? '',
      profileName: profileName ?? '',
    };

    if (version?.trim()) {
      nextState.version = version.trim();
    }

    this.bannerState = nextState;
  }

  /**
   * Updates the session information banner with new model/provider.
   * Attempts in-place update if possible, otherwise re-renders.
   */
  updateSessionInfo(model: string, provider: string) {
    const state = this.bannerState;
    if (!state) {
      return;
    }

    // Validate inputs
    if (!model?.trim() || !provider?.trim()) {
      return;
    }

    const lines = this.buildSessionLines(
      state.profileLabel,
      state.profileName,
      model,
      provider,
      state.workingDir,
      state.width
    );
    const banner = this.buildBanner(
      'APT CLI',
      state.width,
      lines,
      this.buildBannerOptions(state.version)
    );
    const height = this.measureBannerHeight(banner);

    // If height changed or rewrite failed, do full re-render
    if (height !== state.height || !this.tryRewriteBanner(state, banner)) {
      this.renderAndStoreBanner(state, model, provider);
      return;
    }

    // Update succeeded, update state
    state.model = model;
    state.provider = provider;
  }

  showThinking(message: string = 'Thinking...') {
    if (this.activeSpinner) {
      this.activeSpinner.stop();
    }
    // Use Claude Code style spinner with epsilon: ∴, ε, and ✻
    this.activeSpinner = createSpinner(message, {
      spinner: {
        interval: DISPLAY_CONSTANTS.SPINNER_INTERVAL,
        frames: [...SPINNER_FRAMES],
      },
    } as any).start();
  }

  updateThinking(message: string) {
    if (this.activeSpinner) {
      this.activeSpinner.update({ text: message });
    } else {
      this.showThinking(message);
    }
  }

  stopThinking() {
    if (this.activeSpinner) {
      this.activeSpinner.clear();
      this.activeSpinner = null;
    }
  }

  showAssistantMessage(content: string, metadata?: DisplayMessageMetadata) {
    if (!content.trim()) {
      return;
    }
    const isThought = metadata?.isFinal === false;
    const body = isThought ? this.buildClaudeStyleThought(content) : this.buildChatBox(content, metadata);
    if (!body.trim()) {
      return;
    }
    this.withOutput(() => {
      console.log(body);
      console.log();
    });
  }

  showAction(text: string, status: ActionStatus = 'info') {
    if (!text.trim()) {
      return;
    }
    // Claude Code style: always use ⏺ prefix for actions
    const icon = this.formatActionIcon(status);
    this.withOutput(() => {
      console.log(this.wrapWithPrefix(text, `${icon} `));
    });
  }

  showSubAction(text: string, status: ActionStatus = 'info') {
    if (!text.trim()) {
      return;
    }
    const prefersRich = text.includes('```');
    let rendered = prefersRich ? this.buildRichSubActionLines(text, status) : this.buildWrappedSubActionLines(text, status);
    if (!rendered.length && prefersRich) {
      rendered = this.buildWrappedSubActionLines(text, status);
    }
    if (!rendered.length) {
      return;
    }
    this.withOutput(() => {
      console.log(rendered.join('\n'));
      console.log();
    });
  }

  private buildWrappedSubActionLines(text: string, status: ActionStatus): string[] {
    const lines = text.split('\n').map((line) => line.trimEnd());
    while (lines.length && !lines[lines.length - 1]?.trim()) {
      lines.pop();
    }
    if (!lines.length) {
      return [];
    }
    const rendered: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const segment = lines[index] ?? '';
      const isLast = index === lines.length - 1;
      const { prefix, continuation } = this.buildSubActionPrefixes(status, isLast);
      rendered.push(this.wrapWithPrefix(segment, prefix, { continuationPrefix: continuation }));
    }
    return rendered;
  }

  private buildRichSubActionLines(text: string, status: ActionStatus): string[] {
    const normalized = text.trim();
    if (!normalized) {
      return [];
    }
    const width = Math.max(
      DISPLAY_CONSTANTS.MIN_ACTION_WIDTH,
      Math.min(getTerminalColumns(), DISPLAY_CONSTANTS.MAX_ACTION_WIDTH)
    );
    const samplePrefix = this.buildSubActionPrefixes(status, true).prefix;
    const contentWidth = Math.max(
      DISPLAY_CONSTANTS.MIN_CONTENT_WIDTH,
      width - this.visibleLength(samplePrefix)
    );
    const blocks = formatRichContent(normalized, contentWidth);
    if (!blocks.length) {
      return [];
    }
    return blocks.map((line, index) => {
      const isLast = index === blocks.length - 1;
      const { prefix } = this.buildSubActionPrefixes(status, isLast);
      if (!line.trim()) {
        return prefix.trimEnd();
      }
      return `${prefix}${line}`;
    });
  }

  showMessage(content: string, role: 'assistant' | 'system' = 'assistant') {
    if (role === 'system') {
      this.showSystemMessage(content);
    } else {
      this.showAssistantMessage(content);
    }
  }

  showSystemMessage(content: string) {
    this.withOutput(() => {
      console.log(content.trim());
      console.log();
    });
  }

  showError(message: string) {
    const callout = renderCallout(message, {
      tone: 'danger',
      icon: icons.error,
      title: 'Error',
      width: this.getBannerWidth(),
    });
    this.withOutput(() => {
      console.error(`\n${callout}\n`);
    });
  }

  showWarning(message: string) {
    const callout = renderCallout(message, {
      tone: 'warning',
      icon: icons.warning,
      title: 'Warning',
      width: this.getBannerWidth(),
    });
    this.withOutput(() => {
      console.warn(`${callout}`);
    });
  }

  showInfo(message: string) {
    const callout = renderCallout(message, {
      tone: 'info',
      icon: icons.info,
      title: 'Info',
      width: this.getBannerWidth(),
    });
    this.withOutput(() => {
      console.log(callout);
    });
  }

  showAvailableTools(_tools: Array<{ name: string; description: string }>) {
    // Hidden by default to match Claude Code style
    // Tools are available but not listed verbosely on startup
    // Parameter prefixed with underscore to indicate intentionally unused
  }

  showPlanningStep(step: string, index: number, total: number) {
    // Validate inputs
    if (!step?.trim()) {
      return;
    }
    if (index < 1 || total < 1 || index > total) {
      return;
    }

    const width = Math.max(
      DISPLAY_CONSTANTS.MIN_THOUGHT_WIDTH,
      Math.min(getTerminalColumns(), DISPLAY_CONSTANTS.MAX_MESSAGE_WIDTH)
    );

    const heading = renderSectionHeading(`Plan ${index}/${total}`, {
      subtitle: step,
      icon: icons.arrow,
      tone: 'info',
      width,
    });
    this.withOutput(() => {
      console.log(heading);
    });
  }

  clear() {
    this.withOutput(() => {
      console.clear();
    });
    this.stdoutTracker.reset();
    if (this.bannerState) {
      this.renderAndStoreBanner(this.bannerState, this.bannerState.model, this.bannerState.provider);
    }
  }

  newLine() {
    this.withOutput(() => {
      console.log();
    });
  }

  private getBannerWidth(): number {
    const availableColumns = getTerminalColumns();
    const effectiveWidth = Math.max(
      DISPLAY_CONSTANTS.MIN_BANNER_WIDTH,
      availableColumns - DISPLAY_CONSTANTS.BANNER_PADDING
    );
    return Math.min(
      Math.max(effectiveWidth, DISPLAY_CONSTANTS.MIN_BANNER_WIDTH),
      DISPLAY_CONSTANTS.MAX_BANNER_WIDTH
    );
  }

  private buildSessionLines(
    profileLabel: string,
    profileName: string,
    model: string,
    provider: string,
    workingDir: string,
    width: number
  ): string[] {
    const normalizedLabel = profileLabel ? profileLabel.trim() : '';
    const normalizedProfile = profileName ? profileName.trim() : '';
    const agentLabel = normalizedLabel || normalizedProfile || 'Active agent';
    const modelSummary = [this.formatModelLabel(model), provider].join(' • ');
    const lines = [
      ...this.formatInfoBlock('Agent', agentLabel, width, this.getInfoFieldStyle('agent')),
    ];

    if (normalizedProfile) {
      lines.push(...this.formatInfoBlock('Profile', normalizedProfile, width, this.getInfoFieldStyle('profile')));
    }

    lines.push(
      ...this.formatInfoBlock('Model', modelSummary, width, this.getInfoFieldStyle('model')),
      ...this.formatInfoBlock('Workspace', workingDir, width, this.getInfoFieldStyle('workspace'))
    );

    return lines;
  }

  private measureBannerHeight(banner: string): number {
    if (!banner) {
      return 0;
    }
    const lines = banner.split('\n').length;
    return lines;
  }

  /**
   * Attempts to rewrite the banner in place using terminal cursor manipulation.
   * Returns true if successful, false if rewrite is not possible.
   */
  private tryRewriteBanner(state: BannerState, banner: string): boolean {
    // Validate TTY availability
    if (!process.stdout.isTTY) {
      return false;
    }

    // Validate banner state
    if (!banner || state.height <= 0) {
      return false;
    }

    const linesWritten = this.stdoutTracker.totalLines;
    const linesAfterBanner = linesWritten - (state.startLine + state.height);

    // Cannot rewrite if banner position is invalid
    if (linesAfterBanner < 0) {
      return false;
    }

    const totalOffset = linesAfterBanner + state.height;
    const maxRows = process.stdout.rows;

    // Cannot rewrite if offset exceeds terminal height
    if (typeof maxRows === 'number' && maxRows > 0 && totalOffset > maxRows) {
      return false;
    }

    try {
      this.withOutput(() => {
        // Move cursor up to banner start
        moveCursor(process.stdout, 0, -totalOffset);
        cursorTo(process.stdout, 0);

        // Write new banner without tracking
        this.stdoutTracker.withSuspended(() => {
          process.stdout.write(`${banner}\n`);
        });

        // Restore cursor position
        if (linesAfterBanner > 0) {
          moveCursor(process.stdout, 0, linesAfterBanner);
        }
        cursorTo(process.stdout, 0);
      });
      return true;
    } catch (error) {
      // Cursor manipulation failed (e.g., terminal doesn't support it)
      if (error instanceof Error) {
        // Could log error in debug mode if needed
      }
      return false;
    }
  }

  private renderAndStoreBanner(state: BannerState, model: string, provider: string): void {
    const width = this.getBannerWidth();
    const lines = this.buildSessionLines(
      state.profileLabel,
      state.profileName,
      model,
      provider,
      state.workingDir,
      width
    );
    const banner = this.buildBanner('APT CLI', width, lines, this.buildBannerOptions(state.version));
    const startLine = this.stdoutTracker.totalLines;
    this.withOutput(() => {
      console.log(banner);
    });

    state.startLine = startLine;
    state.height = this.measureBannerHeight(banner);
    state.width = width;
    state.model = model;
    state.provider = provider;
  }

  private formatModelLabel(model: string): string {
    if (/gpt-5\.1-?codex/i.test(model)) {
      return model;
    }
    if (/sonnet-4[-.]?5/i.test(model)) {
      return 'Sonnet 4.5';
    }
    if (/opus-4[-.]?1/i.test(model)) {
      return 'Opus 4.1';
    }
    if (/haiku-4[-.]?5/i.test(model)) {
      return 'Haiku 4.5';
    }
    if (/gpt-5\.1/i.test(model)) {
      return 'GPT-5.1';
    }
    if (/gpt-5-?pro/i.test(model)) {
      return 'GPT-5 Pro';
    }
    if (/gpt-5-?mini/i.test(model)) {
      return 'GPT-5 Mini';
    }
    if (/gpt-5-?nano/i.test(model)) {
      return 'GPT-5 Nano';
    }
    return model;
  }

  private buildChatBox(content: string, metadata?: DisplayMessageMetadata): string {
    const normalized = content.trim();
    if (!normalized) {
      return '';
    }
    const width = this.resolveMessageWidth();
    const panel = renderMessagePanel(normalized, {
      width,
      title: 'Assistant',
      icon: icons.assistant,
      accentColor: theme.assistant ?? theme.primary,
      borderColor: theme.ui.border,
    });
    const telemetry = this.formatTelemetryLine(metadata);
    if (!telemetry) {
      return panel;
    }
    return `${panel}\n${telemetry}`;
  }

  private resolveMessageWidth(): number {
    const columns = getTerminalColumns();
    return Math.max(
      DISPLAY_CONSTANTS.MIN_MESSAGE_WIDTH,
      Math.min(columns - DISPLAY_CONSTANTS.MESSAGE_PADDING, DISPLAY_CONSTANTS.MAX_MESSAGE_WIDTH)
    );
  }

  /**
   * Legacy method for appending thought blocks with tree-like formatting.
   * Kept for backwards compatibility but not actively used.
   * @deprecated Use buildClaudeStyleThought instead
   */
  // @ts-expect-error - Legacy method kept for backwards compatibility
  private _appendThoughtBlock(block: string, format: ThoughtFormatConfig, output: string[]): void {
    const rawLines = block.split('\n');
    const indices = rawLines
      .map((line, index) => (line.trim().length ? index : -1))
      .filter((index) => index >= 0);

    if (!indices.length) {
      return;
    }

    const lastIndex = indices[indices.length - 1];
    let usedFirst = false;

    for (let index = 0; index < rawLines.length; index += 1) {
      const rawLine = rawLines[index] ?? '';
      if (!rawLine.trim()) {
        continue;
      }
      const segments = this.wrapThoughtLine(rawLine, format.available);
      if (!segments.length) {
        continue;
      }
      const isLastLine = index === lastIndex;
      segments.forEach((segment, segmentIndex) => {
        const prefix = this.resolveThoughtPrefix({
          usedFirst,
          segmentIndex,
          isLastLine,
          format,
        });
        output.push(`${prefix}${segment}`);
      });
      usedFirst = true;
    }
  }

  private resolveThoughtPrefix(options: {
    usedFirst: boolean;
    segmentIndex: number;
    isLastLine: boolean;
    format: ThoughtFormatConfig;
  }): string {
    if (!options.usedFirst) {
      return options.segmentIndex === 0 ? options.format.bullet : options.format.spacer;
    }

    if (options.segmentIndex === 0) {
      return options.isLastLine ? options.format.last : options.format.branch;
    }

    return options.format.spacer;
  }

  /**
   * Legacy method for generating thought formatting configuration.
   * Kept for backwards compatibility but not actively used.
   * @deprecated Use buildClaudeStyleThought instead
   */
  // @ts-expect-error - Legacy method kept for backwards compatibility
  private _getThoughtFormat(): ThoughtFormatConfig {
    const totalWidth = Math.max(
      DISPLAY_CONSTANTS.MIN_THOUGHT_WIDTH,
      Math.min(getTerminalColumns(), DISPLAY_CONSTANTS.MAX_THOUGHT_WIDTH)
    );
    const prefixWidth = Math.max(3, this.visibleLength(`${icons.bullet} `));
    const available = Math.max(DISPLAY_CONSTANTS.MIN_WRAP_WIDTH, totalWidth - prefixWidth);

    return {
      totalWidth,
      prefixWidth,
      available,
      bullet: theme.secondary(this.padPrefix(`${icons.bullet} `, prefixWidth)),
      branch: theme.ui.muted(this.padPrefix('│ ', prefixWidth)),
      last: theme.ui.muted(this.padPrefix('└ ', prefixWidth)),
      spacer: ' '.repeat(prefixWidth),
    };
  }

  private wrapThoughtLine(line: string, width: number): string[] {
    const preserveIndentation = /^\s/.test(line);
    const normalized = preserveIndentation ? line.replace(/\s+$/, '') : line.trim();
    if (!normalized) {
      return [];
    }
    if (preserveIndentation) {
      return wrapPreformatted(normalized, width);
    }
    return this.wrapLine(normalized, width);
  }

  private formatTelemetryLine(metadata?: DisplayMessageMetadata): string {
    if (!metadata) {
      return '';
    }
    const parts: string[] = [];
    const elapsed = this.formatElapsed(metadata.elapsedMs);
    if (elapsed) {
      const elapsedLabel = theme.metrics?.elapsedLabel ?? theme.accent;
      const elapsedValue = theme.metrics?.elapsedValue ?? theme.secondary;
      parts.push(`${elapsedLabel('elapsed')} ${elapsedValue(elapsed)}`);
    }
    if (!parts.length) {
      return '';
    }
    const separator = theme.ui.muted(' • ');
    return `  ${parts.join(separator)}`;
  }

  private formatElapsed(elapsedMs?: number): string | null {
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
      return null;
    }
    const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
    }
    return `${seconds}s`;
  }

  private buildClaudeStyleBanner(
    profileLabel: string,
    model: string,
    _provider: string,
    workingDir: string,
    width: number
  ): string {
    const gradient = theme.gradient.cool;
    const dim = theme.ui.muted;

    // Build centered content
    const lines: string[] = [];

    // Top border
    lines.push(gradient(`╭${'─'.repeat(width)}╮`));

    // Empty line
    lines.push(gradient('│') + ' '.repeat(width) + gradient('│'));

    // Welcome message - centered
    const userName = process.env['USER'] || 'User';
    const welcome = `Welcome back ${userName}!`;
    lines.push(this.centerLine(welcome, width, gradient));

    // Empty line
    lines.push(gradient('│') + ' '.repeat(width) + gradient('│'));

    // Empty line
    lines.push(gradient('│') + ' '.repeat(width) + gradient('│'));

    // Epsilon logo - centered (Claude Code style)
    const logo = [
      '∴  ε  ∴',
      '✻ ε ε ε ✻',
      '∴  ε  ∴',
    ];
    for (const logoLine of logo) {
      lines.push(this.centerLine(logoLine, width, gradient));
    }

    // Empty line
    lines.push(gradient('│') + ' '.repeat(width) + gradient('│'));

    // Empty line
    lines.push(gradient('│') + ' '.repeat(width) + gradient('│'));

    // Model name - centered
    lines.push(this.centerLine(model, width, gradient));

    // Profile label - centered
    lines.push(this.centerLine(profileLabel, width, gradient, dim));

    // Workspace - centered
    const shortPath = this.abbreviatePath(workingDir, width - 8);
    lines.push(this.centerLine(shortPath, width, gradient, dim));

    // Empty line
    lines.push(gradient('│') + ' '.repeat(width) + gradient('│'));

    // Bottom border
    lines.push(gradient(`╰${'─'.repeat(width)}╯`));

    return lines.join('\n');
  }

  private centerLine(
    text: string,
    width: number,
    borderColor: (s: string) => string,
    textColor?: (s: string) => string
  ): string {
    const visibleLen = this.visibleLength(text);
    const padding = Math.max(0, Math.floor((width - visibleLen) / 2));
    const rightPad = width - visibleLen - padding;
    const colored = textColor ? textColor(text) : text;
    return borderColor('│') + ' '.repeat(padding) + colored + ' '.repeat(rightPad) + borderColor('│');
  }

  private abbreviatePath(path: string, maxLen: number): string {
    if (path.length <= maxLen) return path;
    const parts = path.split('/');
    if (parts.length <= 2) return path;
    return parts[0] + '/.../' + parts[parts.length - 1];
  }

  private buildBanner(
    title: string,
    width: number,
    lines: string[],
    options?: { badge?: string }
  ): string {
    const badge = options?.badge ? ` ${options.badge}` : '';
    const titleSegment = `─ ${title}${badge} `;
    const filler = '─'.repeat(Math.max(0, width - titleSegment.length));
    const gradient = theme.gradient.cool;
    const top = gradient(`╭${titleSegment}${filler}╮`);
    const body = lines.map((line) => this.buildBannerLine(line, width)).join('\n');
    const bottom = gradient(`╰${'─'.repeat(width)}╯`);
    return `${top}\n${body}\n${bottom}`;
  }

  private buildBannerOptions(version?: string): { badge: string } | undefined {
    if (!version?.trim()) {
      return undefined;
    }
    return { badge: `${version.trim()} • support@ero.solar` };
  }

  private buildBannerLine(text: string, width: number): string {
    const padded = this.padLine(text, width);
    const tinted = theme.ui.background(theme.ui.text(padded));
    const edge = theme.gradient.primary('│');
    return `${edge}${tinted}${edge}`;
  }

  private padLine(text: string, width: number): string {
    const visible = this.visibleLength(text);
    if (visible >= width) {
      return this.truncateVisible(text, width);
    }
    const padding = Math.max(0, width - visible);
    return `${text}${' '.repeat(padding)}`;
  }

  /**
   * Formats an info block with label and value, wrapping if needed.
   * First line gets the label prefix, subsequent lines are indented.
   */
  private formatInfoBlock(
    label: string,
    value: string,
    width: number,
    options?: InfoBlockStyleOptions
  ): string[] {
    // Validate inputs
    if (!label?.trim() || !value?.trim()) {
      return [];
    }
    if (width <= 0) {
      return [value];
    }

    const prefix = `${label.toUpperCase()}: `;
    const prefixLength = prefix.length;
    const available = Math.max(DISPLAY_CONSTANTS.MIN_CONTENT_WIDTH, width - prefixLength);
    const wrapped = this.wrapLine(value, available);

    return wrapped.map((line, index) => {
      const indent = index === 0 ? prefix : ' '.repeat(prefixLength);
      const raw = `${indent}${line}`;
      const padded = this.padLine(raw, width);

      if (!options) {
        return padded;
      }

      const labelColor = index === 0 ? options.labelColor : undefined;
      return this.applyInfoLineStyles(
        padded,
        prefixLength,
        line.length,
        labelColor,
        options.valueColor
      );
    });
  }

  private applyInfoLineStyles(
    line: string,
    prefixLength: number,
    valueLength: number,
    labelColor?: (value: string) => string,
    valueColor?: (value: string) => string
  ): string {
    const prefix = line.slice(0, prefixLength);
    const remainder = line.slice(prefixLength);
    const tintedPrefix = labelColor ? labelColor(prefix) : prefix;
    const safeValueLength = Math.max(0, Math.min(valueLength, remainder.length));
    if (!valueColor || safeValueLength <= 0) {
      return `${tintedPrefix}${remainder}`;
    }
    const valueSegment = remainder.slice(0, safeValueLength);
    const trailing = remainder.slice(safeValueLength);
    const tintedValue = valueColor(valueSegment);
    return `${tintedPrefix}${tintedValue}${trailing}`;
  }

  private getInfoFieldStyle(field: InfoField): InfoBlockStyleOptions {
    const labelColor = theme.fields?.label ?? ((text: string) => text);
    const valueColor = (theme.fields?.[field] as ((text: string) => string) | undefined) ?? ((text: string) => text);
    return {
      labelColor,
      valueColor,
    };
  }

  /**
   * Wraps text with a prefix on the first line and optional continuation prefix.
   * Handles multi-line text and word wrapping intelligently.
   */
  private wrapWithPrefix(text: string, prefix: string, options?: PrefixWrapOptions): string {
    if (!text) {
      return prefix.trimEnd();
    }

    const width = Math.max(
      DISPLAY_CONSTANTS.MIN_ACTION_WIDTH,
      Math.min(getTerminalColumns(), DISPLAY_CONSTANTS.MAX_ACTION_WIDTH)
    );
    const prefixWidth = this.visibleLength(prefix);
    const available = Math.max(DISPLAY_CONSTANTS.MIN_CONTENT_WIDTH, width - prefixWidth);
    const indent =
      typeof options?.continuationPrefix === 'string'
        ? options.continuationPrefix
        : ' '.repeat(Math.max(0, prefixWidth));

    const segments = text.split('\n');
    const lines: string[] = [];
    let usedPrefix = false;

    for (const segment of segments) {
      if (!segment.trim()) {
        if (usedPrefix) {
          lines.push(indent);
        } else {
          lines.push(prefix.trimEnd());
          usedPrefix = true;
        }
        continue;
      }

      const wrapped = this.wrapLine(segment.trim(), available);
      for (const line of wrapped) {
        lines.push(!usedPrefix ? `${prefix}${line}` : `${indent}${line}`);
        usedPrefix = true;
      }
    }

    return lines.join('\n');
  }

  private resolveStatusColor(status: ActionStatus) {
    switch (status) {
      case 'success':
        return theme.success;
      case 'error':
        return theme.error;
      case 'warning':
        return theme.warning;
      case 'pending':
        return theme.info;
      default:
        return theme.secondary;
    }
  }

  private formatActionIcon(status: ActionStatus): string {
    const colorize = this.resolveStatusColor(status);
    return colorize(`${icons.action}`);
  }


  private buildClaudeStyleThought(content: string): string {
    // Claude Code style: compact ⏺ prefix for thoughts/reasoning
    const prefix = theme.ui.muted('⏺') + ' ';
    return this.wrapWithPrefix(content, prefix);
  }

  // @ts-ignore - Legacy method kept for compatibility
  // Keep legacy method to avoid breaking changes

  private buildSubActionPrefixes(status: ActionStatus, isLast: boolean) {
    if (isLast) {
      const colorize = this.resolveStatusColor(status);
      // Claude Code style: use ⎿ for sub-action result/detail prefix
      return {
        prefix: `  ${colorize(icons.subaction)} `,
        continuation: '    ',
      };
    }
    const branch = theme.ui.muted('│');
    return {
      prefix: `  ${branch} `,
      continuation: `  ${branch} `,
    };
  }

  /**
   * Wraps a single line of text to fit within the specified width.
   * Intelligently handles word breaking and preserves spaces.
   */
  private wrapLine(text: string, width: number): string[] {
    // Handle edge cases
    if (width <= 0) {
      return [text];
    }
    if (!text) {
      return [''];
    }
    if (text.length <= width) {
      return [text];
    }

    const words = text.split(/\s+/).filter(Boolean);

    // If no words, chunk the entire text
    if (!words.length) {
      return this.chunkWord(text, width);
    }

    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const appendResult = this.tryAppendWord(current, word, width);

      if (appendResult.shouldFlush) {
        lines.push(current);
      }

      if (appendResult.chunks.length > 0) {
        // Word was too long and was chunked
        lines.push(...appendResult.chunks.slice(0, -1));
        current = appendResult.chunks[appendResult.chunks.length - 1] ?? '';
      } else {
        current = appendResult.newCurrent;
      }
    }

    if (current) {
      lines.push(current);
    }

    return lines.length ? lines : [''];
  }

  /**
   * Attempts to append a word to the current line.
   * Returns instructions on how to handle the word.
   */
  private tryAppendWord(current: string, word: string, width: number): WordAppendResult {
    if (!word) {
      return { shouldFlush: false, newCurrent: current, chunks: [] };
    }

    // Empty current line - start new line with word
    if (!current) {
      if (word.length <= width) {
        return { shouldFlush: false, newCurrent: word, chunks: [] };
      }
      // Word too long, need to chunk it
      return { shouldFlush: false, newCurrent: '', chunks: this.chunkWord(word, width) };
    }

    // Word fits on current line with space
    if (current.length + 1 + word.length <= width) {
      return { shouldFlush: false, newCurrent: `${current} ${word}`, chunks: [] };
    }

    // Word doesn't fit - flush current and start new line
    if (word.length <= width) {
      return { shouldFlush: true, newCurrent: word, chunks: [] };
    }

    // Word doesn't fit and is too long - flush current and chunk word
    return { shouldFlush: true, newCurrent: '', chunks: this.chunkWord(word, width) };
  }

  /**
   * Splits a long word into chunks that fit within the specified width.
   * Used when a single word is too long to fit on one line.
   */
  private chunkWord(word: string, width: number): string[] {
    if (width <= 0 || !word) {
      return word ? [word] : [''];
    }

    const chunks: string[] = [];
    for (let i = 0; i < word.length; i += width) {
      chunks.push(word.slice(i, i + width));
    }

    return chunks.length > 0 ? chunks : [''];
  }

  /**
   * Pads a prefix string to the specified width with spaces.
   */
  private padPrefix(value: string, width: number): string {
    if (!value || value.length >= width || width <= 0) {
      return value;
    }
    return value.padEnd(width, ' ');
  }

  /**
   * Truncates a string to fit within the specified width,
   * accounting for ANSI color codes and adding ellipsis.
   */
  private truncateVisible(value: string, width: number): string {
    if (width <= 0) {
      return '';
    }
    if (!value) {
      return '';
    }

    const plain = this.stripAnsi(value);
    if (plain.length <= width) {
      return value;
    }

    const slice = plain.slice(0, Math.max(1, width - 1));
    return `${slice}…`;
  }

  /**
   * Returns the visible length of a string, excluding ANSI escape codes.
   */
  private visibleLength(value: string): number {
    if (!value) {
      return 0;
    }
    return this.stripAnsi(value).length;
  }

  /**
   * Removes ANSI escape codes from a string to get the visible text.
   * Uses the standard ANSI escape sequence pattern.
   */
  private stripAnsi(value: string): string {
    if (!value) {
      return '';
    }
    return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
  }
}

export const display = new Display();
