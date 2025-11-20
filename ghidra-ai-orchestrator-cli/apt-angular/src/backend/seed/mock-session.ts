import {
  ChatMessage,
  OpsEvent,
  SessionSnapshot,
  Shortcut,
  StreamMeter,
} from '../../shared/session-models';

export const mockChatMessages: ChatMessage[] = [
  {
    id: 'user-boot',
    agent: 'user',
    timestamp: '12:40:03',
    title: 'you · tmux pane 1',
    caption: '~/GitHub/angular-tailwind',
    command: 'apt --profile apt-code --json stream',
    body: [
      'request: replace the placeholder marketing layout with the actual CLI chat feed.',
      'the browser view should feel identical to an APT CLI session (general + apt-code).',
      'show live diffs, command cues, and the dual-profile log so reviewers trust it.'
    ],
    status: 'command dispatched'
  },
  {
    id: 'apt-plan',
    agent: 'apt',
    timestamp: '12:40:07',
    title: 'apt (general) · planning',
    caption: 'stack depth 4 · angular context',
    body: [
      '- scanning workspace and tailwind config...',
      '- ripping out hero gradient panes...',
      '- composing CLI chrome + mirrored chat feed for apt.'
    ],
    status: 'thinking 1.3k tok/s',
    tokens: 'buffer 72%',
    streaming: true,
    extensions: [
      {
        id: 'plan-tool-usage',
        kind: 'tool-usage',
        label: 'plan',
        description: 'Planning stack depth breakdown',
        data: {
          graph: [
            { tool: 'repo.scan', durationMs: 2200 },
            { tool: 'tailwind.audit', durationMs: 940 }
          ]
        }
      }
    ]
  },
  {
    id: 'apt-code-diff',
    agent: 'apt-code',
    timestamp: '12:40:13',
    title: 'apt code · patch builder',
    caption: 'src/app/app.*',
    body: [
      'patched component data model into chatMessages + meters.',
      'rewired template so both apt profiles render like the terminal.',
      'poured new terminal/tmux styling into the Tailwind layer.'
    ],
    status: 'diff streaming',
    tokens: '980 tok/s · 54ms',
    diff: [
      { kind: 'context', text: 'diff --git a/src/app/app.ts b/src/app/app.ts' },
      { kind: 'context', text: '@@ -1,34 +1,74 @@' },
      { kind: 'remove', text: '-  protected readonly streams: StreamChannel[] = [' },
      { kind: 'add', text: '+  protected readonly chatMessages: ChatMessage[] = [' },
      { kind: 'context', text: '  ...' }
    ],
    footer: 'applied patch to workspace · ready for sync'
  },
  {
    id: 'apt-verify',
    agent: 'apt',
    timestamp: '12:40:19',
    title: 'apt (general) · verify',
    caption: 'npm start · smoke checks',
    body: [
      '- viewport now mirrors CLI chrome with shared scrollback.',
      '- keyboard map + telemetry panes wired to live data.',
      '- ready to share using apt share --live.'
    ],
    status: 'tests pass',
    tokens: 'signal 98%',
    footer: 'sync contexts to keep apt general + code aligned.'
  }
];

export const mockStreamMeters: StreamMeter[] = [
  {
    label: 'APT (general)',
    value: 'streaming',
    detail: '1.2k tok/s · latency 72ms',
    tone: 'success'
  },
  {
    label: 'APT Code',
    value: 'diffing',
    detail: '980 tok/s · tmux :2',
    tone: 'info'
  },
  {
    label: 'Workspace sync',
    value: 'clean',
    detail: '/Users/bo/GitHub/angular-tailwind',
    tone: 'success'
  },
  {
    label: 'Merge risk',
    value: '12%',
    detail: 'watching dependency drift',
    tone: 'warn'
  }
];

export const mockOpsEvents: OpsEvent[] = [
  {
    label: 'npm run start',
    detail: 'dev server watch · port 4200',
    meta: '00:03:11 · ok',
    tone: 'info'
  },
  {
    label: 'ng test --watch',
    detail: '18 suites · 96% coverage',
    meta: 'pass',
    tone: 'success'
  },
  {
    label: 'git status',
    detail: 'working tree clean',
    meta: 'ready for share',
    tone: 'success'
  }
];

export const mockShortcuts: Shortcut[] = [
  { keys: 'Shift+Enter', description: 'Send to APT CLI' },
  { keys: 'Cmd+.', description: 'Interrupt streaming response' },
  { keys: 'Ctrl+K', description: 'Merge APT general + code buffers' },
  { keys: 'Esc', description: 'Jump back to terminal input' }
];

export const mockSnapshot: SessionSnapshot = {
  sessionId: 'mock-local',
  source: 'mock',
  chatMessages: mockChatMessages,
  streamMeters: mockStreamMeters,
  opsEvents: mockOpsEvents,
  shortcuts: mockShortcuts,
  status: {
    label: 'apt-cli://mock',
    detail: 'dual-profile mirror (sample data)',
    tone: 'info'
  }
};
