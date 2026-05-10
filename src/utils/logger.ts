export type Logger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

export const logger: Logger = {
  info: (message, meta) => {
    if (meta) {
      console.log(message, meta);
      return;
    }
    console.log(message);
  },
  warn: (message, meta) => {
    if (meta) {
      console.warn(message, meta);
      return;
    }
    console.warn(message);
  },
  error: (message, meta) => {
    if (meta) {
      console.error(message, meta);
      return;
    }
    console.error(message);
  },
};
