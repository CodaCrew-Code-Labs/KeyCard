import { PrismaClient } from '@prisma/client';

// Mock Prisma Client
export const mockPrismaClient = {
  userMapping: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  session: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $queryRaw: jest.fn(),
  $on: jest.fn(),
} as unknown as jest.Mocked<PrismaClient>;

// Reset all mocks
export const resetPrismaMocks = () => {
  Object.values(mockPrismaClient.userMapping).forEach((mock) => {
    if (typeof mock === 'function' && 'mockReset' in mock) {
      (mock as jest.Mock).mockReset();
    }
  });
  Object.values(mockPrismaClient.session).forEach((mock) => {
    if (typeof mock === 'function' && 'mockReset' in mock) {
      (mock as jest.Mock).mockReset();
    }
  });
  (mockPrismaClient.$connect as jest.Mock).mockReset();
  (mockPrismaClient.$disconnect as jest.Mock).mockReset();
  (mockPrismaClient.$queryRaw as jest.Mock).mockReset();
};

// Mock PrismaClient constructor
jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn(() => mockPrismaClient),
  };
});

export default mockPrismaClient;
