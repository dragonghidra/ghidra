import { theme } from './theme.js';

const MIN_WIDTH = 42;
const MAX_WIDTH = 110;
const ANSI_REGEX = /\u001B\[[0-9;]*m/g;

export function getTerminalColumns(defaultWidth = 80): number {
  if (
    typeof process.stdout.columns === 'number' &&
    Number.isFinite(process.stdout.columns) &&
    process.stdout.columns > 0
  ) {
    return process.stdout.columns;
  }
  return defaultWidth;
}

export type Colorize = (value: string) => string;

export interface PanelOptions {
  title?: string;
  icon?: string;
  accentColor?: Colorize;
  borderColor?: Colorize;
  width?: number;
}

export function getContentWidth(): number {
  const columns = getTerminalColumns();
  const usable = typeof columns === 'number' && Number.isFinite(columns) ? columns - 4 : MAX_WIDTH;
  return clampWidth(usable, columns);
}

export function wrapParagraph(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [''];
  }

  const lines: string[] = [];
  let current = words.shift()!;

  for (const word of words) {
    if (measure(`${current} ${word}`) > width) {
      lines.push(current);
      current = word;
    } else {
      current += ` ${word}`;
    }
  }

  lines.push(current);
  return lines;
}

export function wrapPreformatted(text: string, width: number): string[] {
  if (!text) {
    return [''];
  }

  const result: string[] = [];
  let remaining = text;

  while (measure(remaining) > width) {
    result.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }

  if (remaining) {
    result.push(remaining);
  }

  return result.length ? result : [''];
}

export function normalizePanelWidth(width?: number): number {
  if (typeof width === 'number' && Number.isFinite(width)) {
    return clampWidth(width, getTerminalColumns());
  }
  return clampWidth(getContentWidth(), getTerminalColumns());
}

export function renderPanel(lines: string[], options: PanelOptions = {}): string {
  const width = normalizePanelWidth(options.width);
  const border = options.borderColor ?? theme.ui.border;
  const accent = options.accentColor ?? theme.primary;
  const iconSegment = options.icon ? `${options.icon} ` : '';
  const titleText = options.title ? `${iconSegment}${options.title}` : '';

  const top = border(`┌${'─'.repeat(width + 2)}┐`);
  const output: string[] = [top];

  if (titleText) {
    const paddedTitle = padLine(accent(truncate(titleText, width)), width);
    output.push(`${border('│')} ${paddedTitle} ${border('│')}`);
    output.push(border(`├${'─'.repeat(width + 2)}┤`));
  }

  if (!lines.length) {
    lines = [''];
  }

  for (const line of lines) {
    const padded = padLine(line, width);
    output.push(`${border('│')} ${padded} ${border('│')}`);
  }

  output.push(border(`└${'─'.repeat(width + 2)}┘`));
  return output.join('\n');
}

export function measure(text: string): number {
  return stripAnsi(text).length;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

function clampWidth(value: number, columns?: number): number {
  const maxWidth =
    typeof columns === 'number' && Number.isFinite(columns) && columns > 0
      ? Math.max(10, Math.floor(columns - 4))
      : MAX_WIDTH;
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const normalized = Math.min(MAX_WIDTH, Math.floor(value));
  return Math.max(minWidth, Math.min(normalized, maxWidth));
}

function padLine(text: string, width: number): string {
  const visible = measure(text);
  if (visible === width) {
    return text;
  }

  if (visible > width) {
    return truncate(text, width);
  }

  return `${text}${' '.repeat(width - visible)}`;
}

function truncate(text: string, width: number): string {
  const visible = stripAnsi(text);
  if (visible.length <= width) {
    return text;
  }

  const truncated = visible.slice(0, Math.max(1, width - 1));
  return `${truncated}…`;
}
