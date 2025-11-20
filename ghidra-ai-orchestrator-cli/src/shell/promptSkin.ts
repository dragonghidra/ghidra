import type readline from 'node:readline';
import { theme } from '../ui/theme.js';
import { getTerminalColumns, stripAnsi } from '../ui/layout.js';
import type { LiveStatusState } from './liveStatus.js';

const CURSOR_LEFT = (count: number) => `\u001b[${count}D`;
const SAVE_CURSOR = '\u001b7';
const RESTORE_CURSOR = '\u001b8';
const CLEAR_LINE = '\u001b[2K';
const MOVE_TO_COLUMN = (column: number) => `\u001b[${column}G`;
const MOVE_DOWN = (count: number) => (count > 0 ? `\u001b[${count}B` : '');

type WritableReadline = readline.Interface & {
  _refreshLine: () => void;
  output?: NodeJS.WriteStream;
  getPrompt?: () => string;
  _prompt?: string;
  line?: string;
};

export class PromptSkin {
  private readonly rl: WritableReadline;
  private readonly originalRefresh: WritableReadline['_refreshLine'];
  private unpatchWrite: (() => void) | null = null;
  private disposed = false;
  private status: LiveStatusState | null = null;
  private contextPercent: number | null = 100;
  private renderedOverlayRows = 0;
  private overlayVisible = true;
  private overlayEnabled = false;
  private allocatedOverlayRows = 0;
  private outputGuards = 0;
  private overlayVisibleBeforeGuard = false;
  private promptReady = false;
  private suppressOutputGuards = false;

  constructor(rl: readline.Interface) {
    this.rl = rl as WritableReadline;
    this.originalRefresh = this.rl._refreshLine;
    this.patch();
    this.patchOutputStream();
  }

  setStatus(status: LiveStatusState | null): void {
    this.status = status;
    this.renderFrame();
  }

  setContextPercent(percent: number | null): void {
    if (typeof percent === 'number' && Number.isFinite(percent)) {
      this.contextPercent = Math.max(0, Math.min(100, Math.round(percent)));
    } else {
      this.contextPercent = null;
    }
    this.renderFrame();
  }

  setOverlayVisible(visible: boolean): void {
    if (this.overlayVisible === visible) {
      return;
    }
    this.overlayVisible = visible;
    if (!visible) {
      this.clearOverlay();
      return;
    }
    this.renderFrame();
  }

  beginOutput(): void {
    this.outputGuards += 1;
    if (this.outputGuards > 1) {
      return;
    }
    const shouldWipe = this.overlayVisible && this.renderedOverlayRows > 0;
    this.overlayVisibleBeforeGuard = shouldWipe;
    if (shouldWipe) {
      this.wipeOverlayRows();
    }
  }

  endOutput(): void {
    if (this.outputGuards === 0) {
      return;
    }
    this.outputGuards -= 1;
    if (this.outputGuards > 0) {
      return;
    }
    const shouldRestore = this.overlayVisibleBeforeGuard && this.overlayVisible;
    this.overlayVisibleBeforeGuard = false;
    if (shouldRestore) {
      this.renderFrame();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rl._refreshLine = this.originalRefresh;
    if (this.unpatchWrite) {
      this.unpatchWrite();
      this.unpatchWrite = null;
    }
    this.clearOverlay();
  }

  private patch(): void {
    const original = this.originalRefresh;
    const self = this;
    this.rl._refreshLine = function patchedRefresh(this: readline.Interface) {
      self.withSuppressedOutput(() => {
        original.call(this);
      });
      self.handleReadlineRefresh();
    };
  }

  private patchOutputStream(): void {
    const stream = this.rl.output;
    if (!stream || typeof stream.write !== 'function') {
      return;
    }
    const original = stream.write;
    const skin = this;
    stream.write = function patchedWrite(this: typeof stream, chunk: any, encoding?: any, cb?: any) {
      if (skin.suppressOutputGuards) {
        return original.call(this, chunk, encoding, cb);
      }
      skin.beginOutput();
      try {
        return original.call(this, chunk, encoding, cb);
      } finally {
        skin.endOutput();
      }
    };
    this.unpatchWrite = () => {
      stream.write = original;
    };
  }

  private withSuppressedOutput<T>(fn: () => T): T {
    const previous = this.suppressOutputGuards;
    this.suppressOutputGuards = true;
    try {
      return fn();
    } finally {
      this.suppressOutputGuards = previous;
    }
  }

  private handleReadlineRefresh(): void {
    if (this.disposed) {
      return;
    }
    if (!this.promptReady) {
      this.promptReady = true;
    }
    this.renderFrame();
  }

  private renderFrame(): void {
    if (this.disposed || !this.promptReady) {
      return;
    }
    this.extendPromptRow();
    if (!this.overlayEnabled) {
      return;
    }
    this.renderOverlay();
  }

  private extendPromptRow(): void {
    this.withSuppressedOutput(() => {
      if (!this.rl.output || typeof this.rl.output.write !== 'function') {
        return;
      }

      const totalColumns = Math.max(10, getTerminalColumns());
      const promptLength = this.visibleLength(this.currentPrompt());
      const line = this.rl.line ?? '';
      const inputLength = this.visibleLength(line);
      const closingWidth = 1; // right border
      const remaining = totalColumns - promptLength - inputLength - closingWidth;
      if (remaining <= 0) {
        return;
      }

      const filler = theme.ui.background(theme.ui.text(' '.repeat(remaining)));
      const border = theme.ui.border('│');
      const rewind = CURSOR_LEFT(remaining + closingWidth);
      this.rl.output.write(`${filler}${border}${rewind}`);
    });
  }

  private renderOverlay(): void {
    if (!this.overlayVisible) {
      return;
    }
    const stream = this.rl.output;
    if (!stream || typeof stream.write !== 'function') {
      return;
    }

    this.withSuppressedOutput(() => {
      const lines = this.buildOverlayLines();
      const targetRows = Math.max(lines.length, this.renderedOverlayRows);
      if (targetRows === 0) {
        return;
      }
      this.ensureOverlayRows(targetRows);

      stream.write(SAVE_CURSOR);
      for (let index = 0; index < targetRows; index += 1) {
        stream.write(MOVE_TO_COLUMN(1));
        stream.write(MOVE_DOWN(1));
        stream.write(CLEAR_LINE);
        const content = lines[index];
        if (content) {
          stream.write(content);
        }
      }
      stream.write(RESTORE_CURSOR);
      this.renderedOverlayRows = lines.length;
    });
  }

  private ensureOverlayRows(rows: number): void {
    this.withSuppressedOutput(() => {
      if (rows <= this.allocatedOverlayRows) {
        return;
      }
      const stream = this.rl.output;
      if (!stream || typeof stream.write !== 'function') {
        return;
      }
      const growth = rows - this.allocatedOverlayRows;
      stream.write(SAVE_CURSOR);
      stream.write(MOVE_TO_COLUMN(1));
      for (let index = 0; index < growth; index += 1) {
        stream.write('\n');
      }
      stream.write(RESTORE_CURSOR);
      this.allocatedOverlayRows = rows;
    });
  }

  private clearOverlay(): void {
    if (!this.renderedOverlayRows) {
      return;
    }
    this.wipeOverlayRows();
    this.renderedOverlayRows = 0;
  }

  private wipeOverlayRows(): void {
    this.withSuppressedOutput(() => {
      if (!this.renderedOverlayRows) {
        return;
      }
      const stream = this.rl.output;
      if (!stream || typeof stream.write !== 'function') {
        return;
      }
      stream.write(SAVE_CURSOR);
      for (let index = 0; index < this.renderedOverlayRows; index += 1) {
        stream.write(MOVE_TO_COLUMN(1));
        stream.write(MOVE_DOWN(1));
        stream.write(CLEAR_LINE);
      }
      stream.write(RESTORE_CURSOR);
    });
  }

  private buildOverlayLines(): string[] {
    const lines: string[] = [];
    const context = this.formatContextLine();
    if (context) {
      lines.push(context);
    }
    const status = this.formatStatusLine();
    if (status) {
      lines.push(status);
    }
    return lines;
  }

  private formatContextLine(): string | null {
    if (this.contextPercent === null) {
      return theme.ui.muted('  Context usage unavailable · ? for shortcuts');
    }
    const percent = Math.max(0, Math.min(100, this.contextPercent));
    const color =
      percent <= 10
        ? theme.error
        : percent <= 35
          ? theme.warning
          : percent <= 70
            ? theme.info
            : theme.success;
    const percentLabel = color(`${percent}% context left`);
    const hint = theme.ui.muted('· ? for shortcuts');
    return `  ${percentLabel} ${hint}`;
  }

  private formatStatusLine(): string | null {
    if (!this.status) {
      return null;
    }
    const toneColor = this.resolveStatusTone(this.status.tone);
    const bullet = theme.secondary('•');
    const text = toneColor(this.status.text);
    const elapsed = this.status.startedAt ? this.formatElapsed(Date.now() - this.status.startedAt) : null;
    const segments = [`${bullet} ${text}`];
    if (elapsed) {
      const elapsedColor = theme.metrics?.elapsedValue ?? theme.info;
      segments.push(elapsedColor(`(${elapsed})`));
    }
    if (this.status.detail) {
      segments.push(theme.ui.muted(`• ${this.status.detail}`));
    }
    return segments.join(' ');
  }

  private resolveStatusTone(tone?: LiveStatusState['tone']) {
    switch (tone) {
      case 'success':
        return theme.success;
      case 'warning':
        return theme.warning;
      case 'danger':
        return theme.error;
      case 'info':
      default:
        return theme.info;
    }
  }

  private formatElapsed(elapsedMs: number): string | null {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
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

  private currentPrompt(): string {
    if (typeof this.rl.getPrompt === 'function') {
      return this.rl.getPrompt();
    }
    return this.rl._prompt ?? '';
  }

  private visibleLength(value?: string): number {
    if (!value) {
      return 0;
    }
    return stripAnsi(value).length;
  }
}
