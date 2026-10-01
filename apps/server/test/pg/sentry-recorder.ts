import type { CaptureOptions, SentryHandle } from '@foundation/server';

export interface RecordedEvent {
  kind: 'exception' | 'message';
  message: string;
  level?: CaptureOptions['level'];
  fingerprint?: string[];
  context?: Record<string, unknown>;
}

/** A Sentry handle that records what the server reports (no DSN, no network). */
export function recordingSentry(): SentryHandle & { events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  return {
    enabled: true,
    events,
    span: (_info, fn) => fn(() => undefined),
    captureException(error, context, o) {
      events.push({
        kind: 'exception',
        message: error instanceof Error ? error.message : String(error),
        ...(o?.level ? { level: o.level } : {}),
        ...(o?.fingerprint ? { fingerprint: o.fingerprint } : {}),
        ...(context ? { context } : {}),
      });
    },
    captureMessage(message, o) {
      events.push({
        kind: 'message',
        message,
        ...(o?.level ? { level: o.level } : {}),
        ...(o?.fingerprint ? { fingerprint: o.fingerprint } : {}),
        ...(o?.context ? { context: o.context } : {}),
      });
    },
    startCheckIn: () => () => undefined,
    flush: async () => true,
    close: async () => true,
  };
}
