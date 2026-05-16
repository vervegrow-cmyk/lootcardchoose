export type Logger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

const isDebugEnabled = (): boolean => (process.env.LOG_LEVEL ?? "").trim().toLowerCase() === "debug";

const writeLine = (writer: typeof console.log, message: string, meta?: Record<string, unknown>): void => {
  if (!meta) {
    writer(message);
    return;
  }

  try {
    writer(`${message} ${JSON.stringify(meta)}`);
  } catch {
    writer(message);
  }
};

export const logger: Logger = {
  info: (message, meta) => {
    writeLine(console.log, message, meta);
  },
  debug: (message, meta) => {
    if (!isDebugEnabled()) {
      return;
    }
    writeLine(console.debug, message, meta);
  },
  warn: (message, meta) => {
    writeLine(console.warn, message, meta);
  },
  error: (message, meta) => {
    writeLine(console.error, message, meta);
  },
};
