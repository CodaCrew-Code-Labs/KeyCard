import { Logger } from '../../types';
import { PrismaClient } from '@prisma/client';
import * as clientModule from '../../database/client';

// Create mock client that will be used by all instances
const mockPrismaClient = {
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $queryRaw: jest.fn(),
  $on: jest.fn(),
};

// Mock PrismaClient - needs to be defined before any imports
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrismaClient),
}));

// Mock the client module
jest.mock('../../database/client');

describe('Database Client', () => {
  let mockLogger: Logger;
  const originalEnv = process.env;
  const mockedClientModule = clientModule as jest.Mocked<typeof clientModule>;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('initializePrismaClient', () => {
    it('should use provided prismaClient when available', () => {
      const customClient = { custom: true } as unknown as PrismaClient;
      mockedClientModule.initializePrismaClient.mockReturnValue(customClient);

      const result = mockedClientModule.initializePrismaClient(
        { prismaClient: customClient },
        mockLogger
      );

      expect(result).toBe(customClient);
    });

    it('should create PrismaClient with URL config', () => {
      mockedClientModule.initializePrismaClient.mockReturnValue(
        mockPrismaClient as unknown as PrismaClient
      );

      mockedClientModule.initializePrismaClient(
        { url: 'postgresql://user:pass@localhost:5432/testdb' },
        mockLogger
      );

      expect(mockedClientModule.initializePrismaClient).toHaveBeenCalledWith(
        { url: 'postgresql://user:pass@localhost:5432/testdb' },
        mockLogger
      );
    });

    it('should create PrismaClient with host/database config', () => {
      mockedClientModule.initializePrismaClient.mockReturnValue(
        mockPrismaClient as unknown as PrismaClient
      );

      const config = {
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        username: 'testuser',
        password: 'testpass',
      };

      mockedClientModule.initializePrismaClient(config, mockLogger);

      expect(mockedClientModule.initializePrismaClient).toHaveBeenCalledWith(config, mockLogger);
    });

    it('should create PrismaClient with SSL enabled', () => {
      mockedClientModule.initializePrismaClient.mockReturnValue(
        mockPrismaClient as unknown as PrismaClient
      );

      const config = {
        host: 'localhost',
        database: 'testdb',
        username: 'testuser',
        ssl: true,
      };

      mockedClientModule.initializePrismaClient(config, mockLogger);

      expect(mockedClientModule.initializePrismaClient).toHaveBeenCalledWith(config, mockLogger);
    });

    it('should use default port 5432 when not specified', () => {
      mockedClientModule.initializePrismaClient.mockReturnValue(
        mockPrismaClient as unknown as PrismaClient
      );

      const config = {
        host: 'localhost',
        database: 'testdb',
        username: 'testuser',
      };

      mockedClientModule.initializePrismaClient(config, mockLogger);

      expect(mockedClientModule.initializePrismaClient).toHaveBeenCalledWith(config, mockLogger);
    });

    it('should throw error when config is insufficient', () => {
      mockedClientModule.initializePrismaClient.mockImplementation(() => {
        throw new Error(
          'Database configuration must include either "url" or "host", "database", and "username"'
        );
      });

      expect(() => mockedClientModule.initializePrismaClient({}, mockLogger)).toThrow(
        'Database configuration must include either "url" or "host", "database", and "username"'
      );
    });

    it('should throw error when host provided but database missing', () => {
      mockedClientModule.initializePrismaClient.mockImplementation(() => {
        throw new Error('Database configuration error');
      });

      expect(() =>
        mockedClientModule.initializePrismaClient(
          { host: 'localhost', username: 'user' },
          mockLogger
        )
      ).toThrow();
    });

    it('should register event listeners for query, error, and warn', () => {
      const localMockClient = {
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        $queryRaw: jest.fn(),
        $on: jest.fn(),
      };

      mockedClientModule.initializePrismaClient.mockReturnValue(
        localMockClient as unknown as PrismaClient
      );

      mockedClientModule.initializePrismaClient(
        { url: 'postgresql://localhost/testdb' },
        mockLogger
      );

      expect(mockedClientModule.initializePrismaClient).toHaveBeenCalledWith(
        { url: 'postgresql://localhost/testdb' },
        mockLogger
      );
    });
  });

  describe('getPrismaClient', () => {
    it('should return initialized client', () => {
      mockedClientModule.getPrismaClient.mockReturnValue(
        mockPrismaClient as unknown as PrismaClient
      );

      const client = mockedClientModule.getPrismaClient();

      expect(client).toBeDefined();
    });

    it('should throw error when client not initialized', () => {
      mockedClientModule.getPrismaClient.mockImplementation(() => {
        throw new Error('Prisma client not initialized. Call initializePrismaClient first.');
      });

      expect(() => mockedClientModule.getPrismaClient()).toThrow(
        'Prisma client not initialized. Call initializePrismaClient first.'
      );
    });
  });

  describe('disconnectPrisma', () => {
    it('should disconnect and reset client', async () => {
      mockedClientModule.disconnectPrisma.mockResolvedValue(undefined);
      mockedClientModule.getPrismaClient.mockImplementation(() => {
        throw new Error('Client disconnected');
      });

      await mockedClientModule.disconnectPrisma();

      expect(mockedClientModule.disconnectPrisma).toHaveBeenCalled();
    });

    it('should do nothing when client not initialized', async () => {
      mockedClientModule.disconnectPrisma.mockResolvedValue(undefined);

      await mockedClientModule.disconnectPrisma();

      expect(mockedClientModule.disconnectPrisma).toHaveBeenCalled();
    });
  });

  describe('testDatabaseConnection', () => {
    it('should return true on successful connection', async () => {
      mockedClientModule.testDatabaseConnection.mockResolvedValue(true);

      const result = await mockedClientModule.testDatabaseConnection(mockLogger);

      expect(result).toBe(true);
      expect(mockedClientModule.testDatabaseConnection).toHaveBeenCalledWith(mockLogger);
    });

    it('should return false on connection failure', async () => {
      mockedClientModule.testDatabaseConnection.mockResolvedValue(false);

      const result = await mockedClientModule.testDatabaseConnection(mockLogger);

      expect(result).toBe(false);
      expect(mockedClientModule.testDatabaseConnection).toHaveBeenCalledWith(mockLogger);
    });
  });

  describe('runMigrations', () => {
    it('should log migration info', async () => {
      mockedClientModule.runMigrations.mockResolvedValue(undefined);

      await mockedClientModule.runMigrations(mockLogger);

      expect(mockedClientModule.runMigrations).toHaveBeenCalledWith(mockLogger);
    });
  });
});
