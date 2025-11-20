import { randomUUID } from 'node:crypto';
import { ChatMessage, SessionEvent, SessionSnapshot, StreamMeter } from '../../shared/session-models';
import { AgentGateway } from './gateway';
import { mockSnapshot, mockStreamMeters } from '../seed/mock-session';

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class MockGateway implements AgentGateway {
  readonly source = 'mock';
  readonly label = 'sample apt mirror';

  private timer?: NodeJS.Timeout;

  async bootstrap(): Promise<SessionSnapshot> {
    return deepClone(mockSnapshot);
  }

  async start(eventHandler: (event: SessionEvent) => void): Promise<() => void> {
    this.timer = setInterval(() => {
      const message = this.composeStreamingMessage();
      eventHandler({
        type: 'chat-message',
        payload: message
      });

      if (Math.random() > 0.6) {
        eventHandler({
          type: 'extension',
          payload: {
            id: randomUUID(),
            kind: 'tool-usage',
            label: 'mock tool',
            description: 'Synthetic extension payload to demo registry support',
            data: {
              tool: 'mock.apply_patch',
              latencyMs: 420 + Math.round(Math.random() * 200),
              status: Math.random() > 0.5 ? 'success' : 'warn'
            },
            messageId: message.id
          }
        });
      }

      eventHandler({
        type: 'stream-meters',
        payload: this.bumpMeters()
      });
    }, 8000);

    return () => {
      if (this.timer) {
        clearInterval(this.timer);
      }
    };
  }

  private composeStreamingMessage(): ChatMessage {
    const now = new Date();
    return {
      id: randomUUID(),
      agent: Math.random() > 0.5 ? 'apt-code' : 'apt',
      timestamp: now.toTimeString().split(' ')[0],
      title: Math.random() > 0.5 ? 'apt code · live' : 'apt (general) · watch',
      caption: 'mock stream event',
      status: 'streaming update',
      streaming: true,
      tokens: `${(800 + Math.random() * 400).toFixed(0)} tok/s`,
      body: [
        'mock gateway: emitting synthetic update to prove wiring works.',
        'swap AGENT_SOURCE=local-cli to mirror the actual APT CLI process.'
      ]
    };
  }

  private bumpMeters(): StreamMeter[] {
    const meters = deepClone(mockStreamMeters);
    meters[0] = {
      ...meters[0],
      detail: `1.${Math.round(Math.random() * 4)}k tok/s · latency ${60 + Math.round(Math.random() * 30)}ms`
    };
    return meters;
  }
}
