import winston from 'winston';
import { Logger } from '../types';

export const createLogger = (customLogger?: Logger): Logger => {
  if (customLogger) {
    return customLogger;
  }

  const winstonLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      }),
    ],
  });

  return {
    info: (message: string, meta?: unknown) => winstonLogger.info(message, meta as object),
    error: (message: string, meta?: unknown) => winstonLogger.error(message, meta as object),
    warn: (message: string, meta?: unknown) => winstonLogger.warn(message, meta as object),
    debug: (message: string, meta?: unknown) => winstonLogger.debug(message, meta as object),
  };
};
