import { icons, theme } from './theme.js';
import {
  getContentWidth,
  measure,
  normalizePanelWidth,
  renderPanel,
  type PanelOptions,
  wrapParagraph,
  wrapPreformatted,
} from './layout.js';
import { highlightAndWrapCode } from './codeHighlighter.js';

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; content: string; language?: string }
  | { type: 'diff'; content: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'quote'; lines: string[] }
  | { type: 'divider' };

export function formatRichContent(content: string, width: number): string[] {
  const blocks = parseBlocks(content);
  const lines: string[] = [];

  for (const block of blocks) {
    let blockLines: string[] = [];

    switch (block.type) {
      case 'paragraph': {
        const formatted = formatInlineText(block.text);
        blockLines = wrapParagraph(formatted, width);
        break;
      }
      case 'list':
        blockLines = formatList(block.items, width);
        break;
      case 'code':
        blockLines = formatCodeBlock(block.content, width, block.language);
        break;
      case 'diff':
        blockLines = formatDiffBlock(block.content, width);
        break;
      case 'heading':
        blockLines = formatHeadingBlock(block, width);
        break;
      case 'quote':
        blockLines = formatQuoteBlock(block.lines, width);
        break;
      case 'divider':
        blockLines = [formatDivider(width)];
        break;
      default:
        blockLines = [];
    }

    if (!blockLines.length) {
      continue;
    }

    if (lines.length) {
      const lastLine = lines[lines.length - 1];
      if (lastLine?.trim()) {
        lines.push('');
      }
    }

    lines.push(...blockLines);
  }

  while (lines.length) {
    const lastLine = lines[lines.length - 1];
    if (lastLine?.trim()) {
      break;
    }
    lines.pop();
  }

  return lines;
}

export function renderMessagePanel(
  content: string,
  options: PanelOptions
): string {
  const width = normalizePanelWidth(options.width ?? getContentWidth());
  const lines = formatRichContent(content, width);
  return renderPanel(lines, { ...options, width });
}

export function renderMessageBody(content: string, width?: number): string {
  const normalizedWidth = normalizePanelWidth(width ?? getContentWidth());
  const lines = formatRichContent(content, normalizedWidth);
  return lines.join('\n');
}

export function formatDiffBlock(diff: string, width: number): string[] {
  const lines = diff.replace(/\t/g, '  ').split('\n');
  const result: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      result.push('');
      continue;
    }

    const color = pickDiffColor(line);
    const chunks = wrapPreformatted(line, width);
    chunks.forEach((chunk) => result.push(color(chunk)));
  }

  return result;
}

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split('\n');
  let fence: { language: string; buffer: string[] } | null = null;
  let paragraph: string[] = [];
  let blockquote: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    const merged = paragraph.join('\n');
    const trimmedLines = merged
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (!trimmedLines.length) {
      paragraph = [];
      return;
    }

    const isList = trimmedLines.every((line) =>
      /^(\*|-|•|\d+\.)\s+/.test(line)
    );

    if (isList) {
      blocks.push({
        type: 'list',
        items: trimmedLines.map((line) => line.replace(/^(\*|-|•|\d+\.)\s+/, '')),
      });
    } else {
      blocks.push({ type: 'paragraph', text: trimmedLines.join(' ') });
    }
    paragraph = [];
  };

  const flushBlockquote = () => {
    if (!blockquote?.length) {
      blockquote = null;
      return;
    }
    blocks.push({ type: 'quote', lines: blockquote });
    blockquote = null;
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      const raw = line.trim();
      if (fence) {
        blocks.push(
          fence.language.includes('diff')
            ? { type: 'diff', content: fence.buffer.join('\n') }
            : { type: 'code', content: fence.buffer.join('\n'), language: fence.language }
        );
        fence = null;
        continue;
      }

      flushParagraph();
      flushBlockquote();
      const language = raw.slice(3).trim().toLowerCase();
      fence = { language, buffer: [] };
      continue;
    }

    if (fence) {
      fence.buffer.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushBlockquote();
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      blockquote = blockquote ?? [];
      blockquote.push(quoteMatch[1] ?? '');
      continue;
    }

    flushBlockquote();

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const hashes = headingMatch[1] ?? '';
      const text = headingMatch[2] ?? '';
      blocks.push({ type: 'heading', level: hashes.length, text: text.trim() });
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'divider' });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushBlockquote();
  return blocks;
}

function formatList(items: string[], width: number): string[] {
  const lines: string[] = [];
  const bullet = theme.secondary(`${icons.bullet} `);
  const bulletWidth = measure(`${icons.bullet} `);
  const contentWidth = Math.max(10, width - bulletWidth);

  for (const item of items) {
    const formatted = formatInlineText(item);
    const wrapped = wrapParagraph(formatted, contentWidth);
    wrapped.forEach((segment, index) => {
      if (index === 0) {
        lines.push(`${bullet}${segment}`);
      } else {
        lines.push(`${' '.repeat(bulletWidth)}${segment}`);
      }
    });
  }

  return lines;
}

function formatCodeBlock(code: string, width: number, language?: string): string[] {
  const gutterRaw = '│ ';
  const gutter = theme.ui.muted(gutterRaw);
  const available = Math.max(16, width - measure(gutterRaw));
  const { lines, languageLabel } = highlightAndWrapCode(code, language, available);
  const headerLabel = (languageLabel ?? 'CODE').toUpperCase();
  const result: string[] = [];

  result.push(`${gutter}${theme.ui.muted(buildCodeDivider(headerLabel, available))}`);
  for (const line of lines) {
    result.push(`${gutter}${line}`);
  }

  return result;
}

function formatHeadingBlock(block: { level: number; text: string }, width: number): string[] {
  const wrapped = wrapParagraph(formatInlineText(block.text), width);
  if (!wrapped.length) {
    return [];
  }
  const accent = pickHeadingAccent(block.level);
  const content = wrapped.map((line) => accent(theme.bold(line)));
  if (block.level <= 2) {
    content.push(accent('─'.repeat(width)));
  }
  return content;
}

function formatQuoteBlock(lines: string[], width: number): string[] {
  if (!lines.length) {
    return [];
  }
  const gutterText = '│ ';
  const gutter = theme.ui.muted(gutterText);
  const available = Math.max(12, width - measure(gutterText));
  const result: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      result.push(gutter);
      continue;
    }
    const wrapped = wrapParagraph(formatInlineText(line), available);
    wrapped.forEach((segment) => {
      result.push(`${gutter}${segment}`);
    });
  }

  return result;
}

function formatDivider(width: number): string {
  return theme.ui.muted('─'.repeat(width));
}

function buildCodeDivider(label: string, width: number): string {
  const normalized = label.trim() || 'CODE';
  const targetWidth = Math.max(8, width);
  const title = ` ${normalized} `;
  if (title.length >= targetWidth) {
    return title.slice(0, targetWidth);
  }
  const remaining = targetWidth - title.length;
  const left = '─'.repeat(Math.floor(remaining / 2));
  const right = '─'.repeat(remaining - left.length);
  return `${left}${title}${right}`;
}

function pickDiffColor(line: string) {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return theme.diff.header;
  }
  if (line.startsWith('@@')) {
    return theme.diff.hunk;
  }
  if (line.startsWith('+')) {
    return theme.diff.added;
  }
  if (line.startsWith('-')) {
    return theme.diff.removed;
  }
  if (line.startsWith('diff')) {
    return theme.diff.meta;
  }
  return theme.ui.text;
}

function formatInlineText(text: string): string {
  if (!text) {
    return '';
  }

  const codeSpans: string[] = [];
  const linkSpans: string[] = [];
  const LINK_PLACEHOLDER = '\u0001';

  let result = text.replace(/`([^`]+)`/g, (_, inner) => {
    codeSpans.push(inner);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  const formatBold = (_match: string, value: string) => theme.bold(value);
  result = result.replace(/\*\*(.+?)\*\*/g, formatBold);
  result = result.replace(/__(.+?)__/g, formatBold);

  const formatItalics = (_match: string, value: string) => theme.italic(value);
  result = result.replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, formatItalics);
  result = result.replace(/(?<!_)_(?!_)([^_]+?)(?<!_)_(?!_)/g, formatItalics);

  result = result.replace(/~~(.+?)~~/g, (_match, value) => theme.dim(value));

  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    linkSpans.push(formatMarkdownLink(label, url));
    return `${LINK_PLACEHOLDER}${linkSpans.length - 1}${LINK_PLACEHOLDER}`;
  });

  result = result.replace(/(\bhttps?:\/\/[^\s)]+)([)\]}>,.;:!?"]*)/g, (_match, url, trailing = '') => {
    linkSpans.push(`${formatBareLink(url)}${trailing}`);
    return `${LINK_PLACEHOLDER}${linkSpans.length - 1}${LINK_PLACEHOLDER}`;
  });

  result = result.replace(
    new RegExp(`${LINK_PLACEHOLDER}(\\d+)${LINK_PLACEHOLDER}`, 'g'),
    (_match, index) => linkSpans[Number.parseInt(index, 10)] ?? ''
  );

  result = result.replace(/\u0000(\d+)\u0000/g, (_match, index) =>
    formatInlineCode(codeSpans[Number.parseInt(index, 10)] ?? '')
  );

  return result;
}

function formatInlineCode(value: string): string {
  const normalized = value.length ? value.trim() : value;
  const display = normalized.length ? normalized : value;
  const snippet = display.replace(/\s+/g, ' ');
  return theme.ui.background(theme.ui.text(` ${snippet} `));
}

function formatMarkdownLink(label: string, url: string): string {
  const cleanUrl = url.trim();
  const cleanLabel = label.trim() || cleanUrl;
  const labelColor = theme.link?.label ?? theme.secondary;
  const urlColor = theme.link?.url ?? theme.info;
  const styledLabel = labelColor(cleanLabel);
  const styledUrl = urlColor(`(${cleanUrl})`);
  return `${styledLabel} ${styledUrl}`;
}

function formatBareLink(url: string): string {
  const colorize = theme.link?.url ?? theme.info;
  return colorize(url.trim());
}

function pickHeadingAccent(level: number) {
  if (level <= 1) {
    return theme.primary;
  }
  if (level === 2) {
    return theme.secondary;
  }
  return theme.assistant;
}
