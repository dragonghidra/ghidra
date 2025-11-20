import { SessionEvent, SessionSnapshot } from '../../shared/session-models';

export const reduceSnapshot = (
  current: SessionSnapshot | null,
  event: SessionEvent
): SessionSnapshot => {
  if (!current) {
    if (event.type === 'session') {
      return event.payload;
    }
    throw new Error('Session snapshot not initialized before non-session event arrived.');
  }

  if (event.type === 'session') {
    return event.payload;
  }

  switch (event.type) {
    case 'chat-message':
      return {
        ...current,
        chatMessages: [...current.chatMessages, event.payload]
      };
    case 'chat-replace':
      return {
        ...current,
        chatMessages: current.chatMessages.map((message) =>
          message.id === event.payload.id ? event.payload : message
        )
      };
    case 'chat-history':
      return {
        ...current,
        chatMessages: [...event.payload]
      };
    case 'stream-meters':
      return {
        ...current,
        streamMeters: [...event.payload]
      };
    case 'ops-events':
      return {
        ...current,
        opsEvents: [...event.payload]
      };
    case 'shortcuts':
      return {
        ...current,
        shortcuts: [...event.payload]
      };
    case 'status':
      return {
        ...current,
        status: event.payload
      };
    case 'extension':
      return {
        ...current,
        chatMessages: current.chatMessages.map((message) => {
          if (message.id !== event.payload.messageId) {
            return message;
          }

          const filtered = (message.extensions ?? []).filter((extension) => extension.id !== event.payload.id);
          return { ...message, extensions: [...filtered, event.payload] };
        })
      };
    default:
      return current;
  }
};
