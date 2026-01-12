import { Logger } from '../../types';
import { PrismaClient } from '@prisma/client';

// Mock pg Pool
const mockPoolOn = jest.fn();
const mockPoolEnd = jest.fn().mockResolvedValue(undefined);
const mockPool = {
  on: mockPoolOn,
  end: mockPoolEnd,
};

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
}));

// Mock PrismaPg adapter
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));

// Mock PrismaClient
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockQueryRaw = jest.fn();
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $disconnect: mockDisconnect,
    $queryRaw: mockQueryRaw,
  })),
}));

// Import after mocks are set up
import {
  initializePrismaClient,
  getPrismaClient,
  disconnectPrisma,
  testDatabaseConnection,
  runMigrations,
} from '../../database/client';

describe('Database Client', () => {
  let mockLogger: Logger;
  const originalEnv = process.env;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    // Reset module state by clearing mocks
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('initializePrismaClient', () => {
    it('should use provided prismaClient when available', () => {
      const customClient = { custom: true } as unknown as PrismaClient;

      const result = initializePrismaClient({ prismaClient: customClient }, mockLogger);

      expect(result).toBe(customClient);
    });

    it('should create PrismaClient with URL config', () => {
      const result = initializePrismaClient(
        { url: 'postgresql://user:pass@localhost:5432/testdb' },
        mockLogger
      );

      expect(result).toBeDefined();
      expect(process.env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/testdb');
    });

    it('should create PrismaClient with host/database config', () => {
      const config = {
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        username: 'testuser',
        password: 'testpass',
      };

      const result = initializePrismaClient(config, mockLogger);

      expect(result).toBeDefined();
      expect(process.env.DATABASE_URL).toBe('postgresql://testuser:testpass@localhost:5432/testdb');
    });

    it('should create PrismaClient with SSL enabled', () => {
      const config = {
        host: 'localhost',
        database: 'testdb',
        username: 'testuser',
        ssl: true,
      };

      const result = initializePrismaClient(config, mockLogger);

      expect(result).toBeDefined();
      expect(process.env.DATABASE_URL).toContain('?sslmode=require');
    });

    it('should use default port 5432 when not specified', () => {
      const config = {
        host: 'localhost',
        database: 'testdb',
        username: 'testuser',
      };

      const result = initializePrismaClient(config, mockLogger);

      expect(result).toBeDefined();
      expect(process.env.DATABASE_URL).toContain(':5432/');
    });

    it('should throw error when config is insufficient', () => {
      expect(() => initializePrismaClient({}, mockLogger)).toThrow(
        'Database configuration must include either "url" or "host", "database", and "username"'
      );
    });

    it('should throw error when host provided but database missing', () => {
      expect(() =>
        initializePrismaClient({ host: 'localhost', username: 'user' }, mockLogger)
      ).toThrow(
        'Database configuration must include either "url" or "host", "database", and "username"'
      );
    });

    it('should register pool event listeners', () => {
      initializePrismaClient({ url: 'postgresql://localhost/testdb' }, mockLogger);

      expect(mockPoolOn).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockPoolOn).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockPoolOn).toHaveBeenCalledWith('remove', expect.any(Function));
    });

    it('should handle pool connect event', () => {
      initializePrismaClient({ url: 'postgresql://localhost/testdb' }, mockLogger);

      // Get the connect callback and call it
      const connectCall = mockPoolOn.mock.calls.find((call) => call[0] === 'connect');
      const connectCallback = connectCall[1];
      connectCallback();

      expect(mockLogger.debug).toHaveBeenCalledWith('New PostgreSQL client connected to pool');
    });

    it('should handle pool error event', () => {
      initializePrismaClient({ url: 'postgresql://localhost/testdb' }, mockLogger);

      // Get the error callback and call it
      const errorCall = mockPoolOn.mock.calls.find((call) => call[0] === 'error');
      const errorCallback = errorCall[1];
      const testError = new Error('Pool error');
      errorCallback(testError);

      expect(mockLogger.error).toHaveBeenCalledWith('PostgreSQL pool error', {
        error: 'Pool error',
      });
    });

    it('should handle pool remove event', () => {
      initializePrismaClient({ url: 'postgresql://localhost/testdb' }, mockLogger);

      // Get the remove callback and call it
      const removeCall = mockPoolOn.mock.calls.find((call) => call[0] === 'remove');
      const removeCallback = removeCall[1];
      removeCallback();

      expect(mockLogger.debug).toHaveBeenCalledWith('PostgreSQL client removed from pool');
    });

    it('should handle empty password', () => {
      const config = {
        host: 'localhost',
        database: 'testdb',
        username: 'testuser',
        password: '',
      };

      const result = initializePrismaClient(config, mockLogger);

      expect(result).toBeDefined();
      expect(process.env.DATABASE_URL).toBe('postgresql://testuser:@localhost:5432/testdb');
    });
  });

  describe('getPrismaClient', () => {
    it('should return initialized client', () => {
      // First initialize the client
      initializePrismaClient({ url: 'postgresql://localhost/testdb' }, mockLogger);

      const client = getPrismaClient();

      expect(client).toBeDefined();
    });
  });

  describe('disconnectPrisma', () => {
    it('should disconnect and reset client and pool', async () => {
      // First initialize the client
      initializePrismaClient({ url: 'postgresql://localhost/testdb' }, mockLogger);

      await disconnectPrisma();

      expect(mockDisconnect).toHaveBeenCalled();
      expect(mockPoolEnd).toHaveBeenCalled();
    });
  });

  describe('testDatabaseConnection', () => {
    it('should return true on successful connection', async () => {
      initializePrismaClient({ url: 'postgresql://localhost/testdb' }, mockLogger);
      mockQueryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

      const result = await testDatabaseConnection(mockLogger);

      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Database connection successful');
    });

    it('should return false on connection failure', async () => {
      initializePrismaClient({ url: 'postgresql://localhost/testdb' }, mockLogger);
      mockQueryRaw.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await testDatabaseConnection(mockLogger);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Database connection failed',
        expect.any(Error)
      );
    });
  });

  describe('runMigrations', () => {
    it('should log migration info', async () => {
      await runMigrations(mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith('Checking for pending migrations...');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Migrations should be run manually using: npx prisma migrate deploy'
      );
    });
  });
});
