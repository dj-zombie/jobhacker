import pino, { type Logger } from 'pino';

export type { Logger };

/**
 * Create the shared logger. JSON to stdout by default; pretty in dev when
 * `JOBHACKER_PRETTY_LOGS` is set and `pino-pretty` is available. When `file` is
 * given, JSON log lines are *also* appended to that file (in addition to
 * stdout), which the CLI uses so scheduled runs leave a log in `data/logs/`
 * (FR-10). File output and pretty mode are mutually exclusive; file wins.
 *
 * Invariant 4: never log profile contents, API keys or full LLM prompts at
 * info level. Callers are responsible for not passing secrets in; this module
 * only sets the transport and level.
 */
export function createLogger(options?: {
  level?: string;
  pretty?: boolean;
  file?: string;
}): Logger {
  const level = options?.level ?? process.env.LOG_LEVEL ?? 'info';
  const pretty = options?.pretty ?? Boolean(process.env.JOBHACKER_PRETTY_LOGS);
  const file = options?.file ?? process.env.JOBHACKER_LOG_FILE;

  if (file) {
    const streams = [
      { level, stream: process.stdout },
      { level, stream: pino.destination({ dest: file, append: true, sync: true }) },
    ];
    return pino({ level }, pino.multistream(streams));
  }

  if (pretty) {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }

  return pino({ level });
}

/** A silent logger for tests. */
export function nullLogger(): Logger {
  return pino({ level: 'silent' });
}
