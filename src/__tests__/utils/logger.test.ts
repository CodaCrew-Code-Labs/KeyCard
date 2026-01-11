import { createLogger } from '../../utils/logger';
import { Logger } from '../../types';
import winston from 'winston';

// Mock winston
jest.mock('winston', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  return {
    createLogger: jest.fn(() => mockLogger),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      errors: jest.fn(),
      json: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn(),
    },
    transports: {
      Console: jest.fn(),
    },
  };
});

const mockedWinston = winston as jest.Mocked<typeof winston>;

describe('Logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('createLogger', () => {
    it('should return custom logger when provided', () => {
      const customLogger: Logger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      };

      const logger = createLogger(customLogger);

      expect(logger).toBe(customLogger);
    });

    it('should create winston logger when no custom logger provided', () => {
      const logger = createLogger();

      expect(mockedWinston.createLogger).toHaveBeenCalled();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should use LOG_LEVEL from environment', () => {
      process.env.LOG_LEVEL = 'debug';

      createLogger();

      expect(mockedWinston.createLogger).toHaveBeenCalled();
    });

    it('should use default log level when LOG_LEVEL not set', () => {
      delete process.env.LOG_LEVEL;

      createLogger();

      expect(mockedWinston.createLogger).toHaveBeenCalled();
    });

    it('should create logger with console transport', () => {
      createLogger();

      expect(mockedWinston.transports.Console).toHaveBeenCalled();
    });

    it('should apply formatting options', () => {
      createLogger();

      expect(mockedWinston.format.combine).toHaveBeenCalled();
      expect(mockedWinston.format.timestamp).toHaveBeenCalled();
      expect(mockedWinston.format.errors).toHaveBeenCalledWith({ stack: true });
      expect(mockedWinston.format.json).toHaveBeenCalled();
    });

    describe('logger methods', () => {
      it('should call info with message and meta', () => {
        const logger = createLogger();
        logger.info('Test message', { key: 'value' });

        const mockWinstonLogger = mockedWinston.createLogger();
        expect(mockWinstonLogger.info).toHaveBeenCalledWith('Test message', { key: 'value' });
      });

      it('should call error with message and meta', () => {
        const logger = createLogger();
        logger.error('Error message', { error: 'details' });

        const mockWinstonLogger = mockedWinston.createLogger();
        expect(mockWinstonLogger.error).toHaveBeenCalledWith('Error message', { error: 'details' });
      });

      it('should call warn with message and meta', () => {
        const logger = createLogger();
        logger.warn('Warning message', { warning: 'info' });

        const mockWinstonLogger = mockedWinston.createLogger();
        expect(mockWinstonLogger.warn).toHaveBeenCalledWith('Warning message', { warning: 'info' });
      });

      it('should call debug with message and meta', () => {
        const logger = createLogger();
        logger.debug('Debug message', { debug: 'data' });

        const mockWinstonLogger = mockedWinston.createLogger();
        expect(mockWinstonLogger.debug).toHaveBeenCalledWith('Debug message', { debug: 'data' });
      });

      it('should handle calls without meta', () => {
        const logger = createLogger();
        logger.info('Message only');

        const mockWinstonLogger = mockedWinston.createLogger();
        expect(mockWinstonLogger.info).toHaveBeenCalledWith('Message only', undefined);
      });
    });
  });
});
