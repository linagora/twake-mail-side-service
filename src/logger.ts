import pino from 'pino';

export const logger = pino({
  base: { service: 'twake-mail-side-service' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export type Logger = pino.Logger;
