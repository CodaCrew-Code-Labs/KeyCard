import express, { Express, Router } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

// Mock PrismaClient - use factory function to avoid hoisting issues
jest.mock('@prisma/client', () => {
  const mockUserMapping = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  };
  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      userMapping: mockUserMapping,
    })),
    __mockUserMapping: mockUserMapping,
  };
});

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

// Mock dodoPayments routes
jest.mock('../../routes/dodoPayments', () => ({
  createDodoPaymentsRoutes: jest.fn(() => {
    const router = Router();
    router.get('/test', (_req, res) => res.json({ test: true }));
    return router;
  }),
}));

// Import after mocks
import { createRoutes } from '../../routes';

// Get mock reference
const mockPrismaClient = new PrismaClient();
interface MockPrismaClient {
  userMapping: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
  };
}
const mockUserMapping = (mockPrismaClient as unknown as MockPrismaClient).userMapping;

describe('Main Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', createRoutes());

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('POST /api/v1/user', () => {
    it('should create a new user when user does not exist', async () => {
      mockUserMapping.findUnique.mockResolvedValue(null);
      mockUserMapping.create.mockResolvedValue({
        userUuid: 'test-uuid-1234',
        email: 'test@example.com',
        dodoCustomerId: null,
        createdAt: new Date(),
      });

      const response = await request(app).post('/api/v1/user').send({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        uuid: 'test-uuid-1234',
        created: true,
        message: 'User created successfully',
      });
      expect(mockUserMapping.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(mockUserMapping.create).toHaveBeenCalledWith({
        data: {
          userUuid: 'test-uuid-1234',
          email: 'test@example.com',
        },
      });
    });

    it('should return existing user when user already exists', async () => {
      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'existing-uuid',
        email: 'test@example.com',
        dodoCustomerId: 'dodo-123',
        createdAt: new Date(),
      });

      const response = await request(app).post('/api/v1/user').send({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        uuid: 'existing-uuid',
        created: false,
        message: 'User already exists',
      });
      expect(mockUserMapping.create).not.toHaveBeenCalled();
    });

    it('should return 400 when email is missing', async () => {
      const response = await request(app).post('/api/v1/user').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'email is required in request body',
      });
    });

    it('should return 400 when email is not a string', async () => {
      const response = await request(app).post('/api/v1/user').send({ email: 123 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'email is required in request body',
      });
    });

    it('should handle database errors', async () => {
      mockUserMapping.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app).post('/api/v1/user').send({ email: 'test@example.com' });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/v1/users', () => {
    it('should return list of user emails', async () => {
      mockUserMapping.findMany.mockResolvedValue([
        { email: 'user1@example.com' },
        { email: 'user2@example.com' },
        { email: 'user3@example.com' },
      ]);

      const response = await request(app).get('/api/v1/users');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        emails: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
      });
      expect(mockUserMapping.findMany).toHaveBeenCalledWith({
        select: { email: true },
      });
    });

    it('should return empty array when no users exist', async () => {
      mockUserMapping.findMany.mockResolvedValue([]);

      const response = await request(app).get('/api/v1/users');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ emails: [] });
    });

    it('should handle database errors', async () => {
      mockUserMapping.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/v1/users');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/v1/user/:email', () => {
    it('should return user details when user exists', async () => {
      mockUserMapping.findUnique.mockResolvedValue({
        email: 'test@example.com',
        userUuid: 'uuid-123',
        dodoCustomerId: 'dodo-456',
        createdAt: new Date(),
      });

      const response = await request(app).get('/api/v1/user/test@example.com');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        email: 'test@example.com',
        sob_id: 'uuid-123',
        dodo_customer_id: 'dodo-456',
      });
    });

    it('should return 404 when user does not exist', async () => {
      mockUserMapping.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/user/nonexistent@example.com');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'User not found',
      });
    });

    it('should handle database errors', async () => {
      mockUserMapping.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/v1/user/test@example.com');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/v1/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'healthy',
        database: 'connected',
        payment_provider: 'operational',
      });
      expect(typeof response.body.uptime).toBe('number');
    });
  });

  describe('DodoPayments routes mounting', () => {
    it('should mount dodoPayments routes at /dodopayments', async () => {
      const response = await request(app).get('/api/v1/dodopayments/test');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ test: true });
    });
  });
});
