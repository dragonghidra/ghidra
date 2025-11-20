import chalk from 'chalk';
import gradientString from 'gradient-string';

/**
 * Theme system matching the APT CLI aesthetics
 */
export const theme = {
  primary: chalk.hex('#6366F1'), // Indigo
  secondary: chalk.hex('#8B5CF6'), // Purple
  accent: chalk.hex('#EC4899'), // Pink
  success: chalk.hex('#10B981'), // Green
  warning: chalk.hex('#F59E0B'), // Amber
  error: chalk.hex('#EF4444'), // Red
  info: chalk.hex('#3B82F6'), // Blue

  dim: chalk.dim,
  bold: chalk.bold,
  italic: chalk.italic,
  underline: chalk.underline,

  gradient: {
    primary: gradientString(['#6366F1', '#8B5CF6', '#EC4899']),
    cool: gradientString(['#3B82F6', '#6366F1', '#8B5CF6']),
    warm: gradientString(['#F59E0B', '#EC4899', '#EF4444']),
    success: gradientString(['#10B981', '#34D399']),
  },

  ui: {
    border: chalk.hex('#4B5563'),
    background: chalk.bgHex('#1F2937'),
    userPromptBackground: chalk.bgHex('#4C1D95'),
    muted: chalk.hex('#9CA3AF'),
    text: chalk.hex('#F3F4F6'),
  },

  metrics: {
    elapsedLabel: chalk.hex('#FBBF24').bold,
    elapsedValue: chalk.hex('#F472B6'),
  },

  fields: {
    label: chalk.hex('#FCD34D').bold,
    agent: chalk.hex('#F472B6'),
    profile: chalk.hex('#C084FC'),
    model: chalk.hex('#A855F7'),
    workspace: chalk.hex('#38BDF8'),
  },

  link: {
    label: chalk.hex('#F472B6').underline,
    url: chalk.hex('#38BDF8'),
  },

  diff: {
    header: chalk.hex('#FBBF24'),
    hunk: chalk.hex('#60A5FA'),
    added: chalk.hex('#10B981'),
    removed: chalk.hex('#EF4444'),
    meta: chalk.hex('#9CA3AF'),
  },

  user: chalk.hex('#3B82F6'),
  assistant: chalk.hex('#8B5CF6'),
  system: chalk.hex('#6B7280'),
  tool: chalk.hex('#10B981'),
};

/**
 * Claude Code style icons
 * Following the official Claude Code UI conventions:
 * - ⏺ (action): Used for tool calls, actions, and thinking/reasoning
 * - ⎿ (subaction): Used for results, details, and nested information
 * - ─ (separator): Horizontal lines for dividing sections (not in this object)
 * - > (user prompt): User input prefix (used in formatUserPrompt)
 */
export const icons = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  arrow: '→',
  bullet: '•',
  thinking: '◐',
  tool: '⚙',
  user: '❯',
  assistant: '◆',
  loading: '⣾',
  action: '⏺',      // Claude Code: tool actions and thoughts
  subaction: '⎿',   // Claude Code: results and details
};

export function formatBanner(profileLabel: string, model: string): string {
  const name = profileLabel || 'Agent';
  const title = theme.gradient.primary(name);
  const subtitle = theme.ui.muted(`${model} • Interactive Shell`);

  return `\n${title}\n${subtitle}\n`;
}

export function formatUserPrompt(_profile?: string): string {
  const border = theme.ui.border('│');
  const glyph = theme.user('>');
  const padded = `${theme.ui.text(' ')}${glyph}${theme.ui.text(' ')}`;
  const background = theme.ui.userPromptBackground ?? theme.ui.background;
  const tinted = background(theme.bold(padded));
  return `${border}${tinted} `;
}

export function formatToolCall(name: string, status: 'running' | 'success' | 'error'): string {
  const statusIcon = status === 'running' ? icons.thinking :
                     status === 'success' ? icons.success : icons.error;
  const statusColor = status === 'running' ? theme.info :
                      status === 'success' ? theme.success : theme.error;

  return `${statusColor(statusIcon)} ${theme.tool(name)}`;
}

export function formatMessage(role: 'user' | 'assistant' | 'system', content: string): string {
  switch (role) {
    case 'user':
      return `${theme.user('You:')} ${content}`;
    case 'assistant':
      return `${theme.assistant('Assistant:')} ${content}`;
    case 'system':
      return theme.system(`[System] ${content}`);
  }
}
