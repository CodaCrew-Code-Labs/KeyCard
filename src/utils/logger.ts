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
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
      }),
    ],
  });

  return {
    info: (message: string, meta?: any) => winstonLogger.info(message, meta),
    error: (message: string, meta?: any) => winstonLogger.error(message, meta),
    warn: (message: string, meta?: any) => winstonLogger.warn(message, meta),
    debug: (message: string, meta?: any) => winstonLogger.debug(message, meta),
  };
};
