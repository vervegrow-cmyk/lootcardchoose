export type Logger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

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
  warn: (message, meta) => {
    writeLine(console.warn, message, meta);
  },
  error: (message, meta) => {
    writeLine(console.error, message, meta);
  },
};
