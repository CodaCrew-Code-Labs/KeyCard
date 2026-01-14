import express, { Express, Router } from 'express';
import request from 'supertest';

// Create shared mock objects
const mockUserMapping = {
  findUnique: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockPayment = {
  findMany: jest.fn(),
  count: jest.fn(),
};

const mockSession = {
  findMany: jest.fn(),
  count: jest.fn(),
};

// Mock getPrismaClient from database/client
jest.mock('../../database/client', () => ({
  getPrismaClient: jest.fn(() => ({
    userMapping: mockUserMapping,
    payment: mockPayment,
    session: mockSession,
  })),
}));

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
        activeTier: 'FREE',
        tierExpiresAt: null,
        subscriptionStatus: null,
        createdAt: new Date(),
      });

      const response = await request(app).post('/api/v1/user').send({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        uuid: 'test-uuid-1234',
        created: true,
        dodo_customer_id: null,
        active_tier: 'FREE',
        tier_expires_at: null,
        subscription_status: null,
        message: 'User created successfully',
      });
      expect(mockUserMapping.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(mockUserMapping.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userUuid: 'test-uuid-1234',
          email: 'test@example.com',
          activeTier: 'FREE',
        }),
      });
    });

    it('should return existing user when user already exists', async () => {
      const tierExpiresAt = new Date('2025-02-15T00:00:00Z');
      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'existing-uuid',
        email: 'test@example.com',
        dodoCustomerId: 'dodo-123',
        activeTier: 'PRO',
        tierExpiresAt,
        subscriptionStatus: 'ACTIVE',
        createdAt: new Date(),
      });

      const response = await request(app).post('/api/v1/user').send({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        uuid: 'existing-uuid',
        created: false,
        dodo_customer_id: 'dodo-123',
        active_tier: 'PRO',
        tier_expires_at: tierExpiresAt.toISOString(),
        subscription_status: 'ACTIVE',
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

  describe('GET /api/v1/user/:email/billing', () => {
    it('should return billing info with active tier and latest payment', async () => {
      const mockDate = new Date('2024-01-15T10:00:00Z');
      mockUserMapping.findUnique.mockResolvedValue({
        email: 'test@example.com',
        userUuid: 'uuid-123',
        activeTier: 'PRO',
        tierExpiresAt: mockDate,
        payments: [
          {
            id: 'payment-1',
            dodoPaymentId: 'pay-123',
            status: 'COMPLETED',
            paidAt: mockDate,
            amountCents: 1000,
            currency: 'USD',
            tier: 'PRO',
            createdAt: mockDate,
          },
        ],
      });

      const response = await request(app).get('/api/v1/user/test@example.com/billing');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        activeTier: 'PRO',
        tierExpiresAt: mockDate.toISOString(),
        latestPayment: {
          status: 'COMPLETED',
          paidAt: mockDate.toISOString(),
          amountCents: 1000,
          currency: 'USD',
          tier: 'PRO',
          dodoPaymentId: 'pay-123',
          createdAt: mockDate.toISOString(),
        },
      });
    });

    it('should return billing info with null values when no tier or payments', async () => {
      mockUserMapping.findUnique.mockResolvedValue({
        email: 'test@example.com',
        userUuid: 'uuid-123',
        activeTier: null,
        tierExpiresAt: null,
        payments: [],
      });

      const response = await request(app).get('/api/v1/user/test@example.com/billing');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        activeTier: null,
        tierExpiresAt: null,
        latestPayment: null,
      });
    });

    it('should return 404 when user not found', async () => {
      mockUserMapping.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/user/nonexistent@example.com/billing');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'User not found',
      });
    });
  });

  describe('GET /api/v1/user/:email/payments', () => {
    it('should return paginated payment history', async () => {
      const mockDate = new Date('2024-01-15T10:00:00Z');
      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'uuid-123',
        email: 'test@example.com',
      });

      mockPayment.findMany.mockResolvedValue([
        {
          id: 'payment-1',
          dodoPaymentId: 'pay-123',
          status: 'COMPLETED',
          amountCents: 1000,
          currency: 'USD',
          tier: 'PRO',
          paidAt: mockDate,
          createdAt: mockDate,
        },
        {
          id: 'payment-2',
          dodoPaymentId: 'pay-456',
          status: 'COMPLETED',
          amountCents: 500,
          currency: 'USD',
          tier: 'BASIC',
          paidAt: mockDate,
          createdAt: mockDate,
        },
      ]);

      mockPayment.count.mockResolvedValue(5);

      const response = await request(app).get(
        '/api/v1/user/test@example.com/payments?limit=2&offset=0'
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        payments: [
          {
            id: 'payment-1',
            dodoPaymentId: 'pay-123',
            status: 'COMPLETED',
            amountCents: 1000,
            currency: 'USD',
            tier: 'PRO',
            paidAt: mockDate.toISOString(),
            createdAt: mockDate.toISOString(),
          },
          {
            id: 'payment-2',
            dodoPaymentId: 'pay-456',
            status: 'COMPLETED',
            amountCents: 500,
            currency: 'USD',
            tier: 'BASIC',
            paidAt: mockDate.toISOString(),
            createdAt: mockDate.toISOString(),
          },
        ],
        pagination: {
          total: 5,
          limit: 2,
          offset: 0,
          hasMore: true,
        },
      });
    });

    it('should return 404 when user not found', async () => {
      mockUserMapping.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/user/nonexistent@example.com/payments');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'User not found',
      });
    });
  });

  describe('GET /api/v1/user/:email/sessions', () => {
    it('should return paginated session history', async () => {
      const mockDate = new Date('2024-01-15T10:00:00Z');
      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'uuid-123',
        email: 'test@example.com',
      });

      mockSession.findMany.mockResolvedValue([
        {
          id: 'session-1',
          sessionId: 'sess-123',
          status: 'COMPLETED',
          mode: 'SUBSCRIPTION',
          requestedTier: 'PRO',
          paymentId: 'pay-123',
          subscriptionId: 'sub-123',
          createdDate: mockDate,
          completedAt: mockDate,
        },
      ]);

      mockSession.count.mockResolvedValue(1);

      const response = await request(app).get('/api/v1/user/test@example.com/sessions');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        sessions: [
          {
            id: 'session-1',
            sessionId: 'sess-123',
            status: 'COMPLETED',
            mode: 'SUBSCRIPTION',
            requestedTier: 'PRO',
            paymentId: 'pay-123',
            subscriptionId: 'sub-123',
            createdDate: mockDate.toISOString(),
            completedAt: mockDate.toISOString(),
          },
        ],
        pagination: {
          total: 1,
          limit: 10,
          offset: 0,
          hasMore: false,
        },
      });
    });

    it('should return 404 when user not found', async () => {
      mockUserMapping.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/user/nonexistent@example.com/sessions');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'User not found',
      });
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
