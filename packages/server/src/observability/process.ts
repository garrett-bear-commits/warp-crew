// Process-level failure policy (§8). Installed by the composition root before boot, with or
// without a Sentry DSN, so staging and production behave the same.
//
// - Uncaught exception: the process state is unknown (a throw escaped a callback mid-mutation), so
//   log it, flush Sentry and log shipping, and exit 1; the platform restarts the service.
// - Unhandled rejection: log it and stay up. Every request and job settles its own promise, so a
//   rejection that escapes is a lost background promise (a fire-and-forget DB call), not corrupted
//   state. Exiting would drop every in-flight request on the replica and, when the trigger is
//   recurrent (a database blip seen by a timer), turn one failure into a restart loop. With a DSN,
//   Sentry's OnUnhandledRejection integration (mode 'none') reports it as an unhandled error.
import type { Logger } from 'pino';

export interface ProcessHandlerDeps {
  log: Pick<Logger, 'error' | 'fatal'>;
  /** Flush Sentry and log shipping before an exit (bounded by timeoutMs). */
  flush(timeoutMs: number): Promise<unknown>;
  exit?: (code: number) => void;
  proc?: Pick<NodeJS.Process, 'on'>;
  flushTimeoutMs?: number;
}

export function installProcessHandlers(d: ProcessHandlerDeps): void {
  const proc = d.proc ?? process;
  const exit = d.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = d.flushTimeoutMs ?? 2000;
  let exiting = false;
  proc.on('unhandledRejection', (reason: unknown) => {
    d.log.error({ err: reason }, 'unhandled promise rejection; process stays up');
  });
  proc.on('uncaughtException', (err: Error, origin: string) => {
    d.log.fatal({ err, origin }, 'uncaught exception; exiting');
    if (exiting) return;
    exiting = true;
    // exit even if a flush hangs past its own timeout
    const force = setTimeout(() => exit(1), timeoutMs + 1000);
    force.unref?.();
    void d
      .flush(timeoutMs)
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(force);
        exit(1);
      });
  });
}
