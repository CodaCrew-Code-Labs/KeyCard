import express, { Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';

// Create shared mock objects that will be used by both the mock and tests
const mockUserMapping = {
  findUnique: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};

const mockSession = {
  create: jest.fn(),
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};

const mockPayment = {
  upsert: jest.fn(),
  update: jest.fn(),
};

// Mock getPrismaClient from database/client
jest.mock('../../database/client', () => ({
  getPrismaClient: jest.fn(() => ({
    userMapping: mockUserMapping,
    session: mockSession,
    payment: mockPayment,
  })),
}));

// Mock DodoPaymentsService
const mockCheckoutSessions = {
  create: jest.fn(),
  retrieve: jest.fn(),
};

jest.mock('../../services/dodoPaymentsService', () => ({
  DodoPaymentsService: {
    getClient: jest.fn(() => ({
      checkoutSessions: mockCheckoutSessions,
    })),
  },
}));

// Mock WebhookUtils
jest.mock('../../utils/webhookUtils', () => ({
  WebhookUtils: {
    handleCustomerCreated: jest.fn(),
  },
}));

// Mock tierMapping
jest.mock('../../config/tierMapping', () => ({
  getTierFromProductId: jest.fn((productId: string) => {
    if (productId === 'prod_pro_monthly') {
      return { code: 'PRO', name: 'Pro Monthly', defaultDurationDays: 32 };
    }
    if (productId === 'prod_basic_monthly') {
      return { code: 'BASIC', name: 'Basic Monthly', defaultDurationDays: 32 };
    }
    return null;
  }),
  getTierCodeFromProductId: jest.fn((productId: string) => {
    if (productId === 'prod_pro_monthly') return 'PRO';
    if (productId === 'prod_basic_monthly') return 'BASIC';
    return null;
  }),
  calculateTierExpiration: jest.fn(() => new Date('2025-02-15T00:00:00Z')),
}));

// Import after mocks
import { createDodoPaymentsRoutes } from '../../routes/dodoPayments';

describe('DodoPayments Routes', () => {
  let app: Express;
  const originalEnv = process.env;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/dodopayments', createDodoPaymentsRoutes());

    // Reset all mocks
    jest.clearAllMocks();
    mockUserMapping.findUnique.mockReset();
    mockUserMapping.update.mockReset();
    mockUserMapping.updateMany.mockReset();
    mockSession.create.mockReset();
    mockSession.findFirst.mockReset();
    mockSession.findUnique.mockReset();
    mockSession.update.mockReset();
    mockSession.updateMany.mockReset();
    mockPayment.upsert.mockReset();
    mockPayment.update.mockReset();
    mockCheckoutSessions.create.mockReset();
    mockCheckoutSessions.retrieve.mockReset();

    // Reset environment
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('POST /api/v1/dodopayments/subscribe', () => {
    it('should create checkout session with metadata for existing user', async () => {
      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
        dodoCustomerId: null,
      });

      mockCheckoutSessions.create.mockResolvedValue({
        session_id: 'session-123',
        checkout_url: 'https://checkout.example.com/session-123',
      });

      mockSession.create.mockResolvedValue({
        id: 'db-session-1',
        sessionId: 'session-123',
        userUuid: 'user-uuid-123',
        status: 'PENDING',
      });

      const response = await request(app).post('/api/v1/dodopayments/subscribe').send({
        product_id: 'prod_pro_monthly',
        customer_email: 'test@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        session_url: 'https://checkout.example.com/session-123',
        session_id: 'session-123',
        requested_tier: 'PRO',
      });

      // Verify metadata is sent with user_uuid and requested_tier
      expect(mockCheckoutSessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          product_cart: [{ product_id: 'prod_pro_monthly', quantity: 1 }],
          customer: { email: 'test@example.com' },
          metadata: expect.objectContaining({
            user_uuid: 'user-uuid-123',
            customer_email: 'test@example.com',
            requested_tier: 'PRO',
          }),
        })
      );

      // Verify session is created with requestedTier
      expect(mockSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: 'session-123',
          userUuid: 'user-uuid-123',
          status: 'PENDING',
          mode: 'SUBSCRIPTION',
          requestedTier: 'PRO',
        }),
      });
    });

    it('should use dodo_customer_id when available', async () => {
      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
        dodoCustomerId: 'dodo-cust-456',
      });

      mockCheckoutSessions.create.mockResolvedValue({
        session_id: 'session-123',
        checkout_url: 'https://checkout.example.com/session-123',
      });

      mockSession.create.mockResolvedValue({
        id: 'db-session-1',
        sessionId: 'session-123',
        userUuid: 'user-uuid-123',
        status: 'PENDING',
      });

      const response = await request(app).post('/api/v1/dodopayments/subscribe').send({
        product_id: 'prod_pro_monthly',
        customer_email: 'test@example.com',
      });

      expect(response.status).toBe(200);
      expect(mockCheckoutSessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: { customer_id: 'dodo-cust-456' },
          metadata: expect.objectContaining({
            dodo_customer_id: 'dodo-cust-456',
          }),
        })
      );
    });

    it('should return 404 when user does not exist', async () => {
      mockUserMapping.findUnique.mockResolvedValue(null);

      const response = await request(app).post('/api/v1/dodopayments/subscribe').send({
        product_id: 'prod-123',
        customer_email: 'newuser@example.com',
      });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'User not found. Create user first via POST /user',
      });
      expect(mockSession.create).not.toHaveBeenCalled();
    });

    it('should return 400 when product_id is missing', async () => {
      const response = await request(app).post('/api/v1/dodopayments/subscribe').send({
        customer_email: 'test@example.com',
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'product_id is required',
      });
    });

    it('should return 400 when customer_email is missing', async () => {
      const response = await request(app).post('/api/v1/dodopayments/subscribe').send({
        product_id: 'prod-123',
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'customer_email is required',
      });
    });
  });

  describe('GET /api/v1/dodopayments/checkout/:id', () => {
    it('should retrieve checkout session and update status with payment_id', async () => {
      mockCheckoutSessions.retrieve.mockResolvedValue({
        session_id: 'session-123',
        status: 'completed',
        payment_id: 'pay-123',
        subscription_id: 'sub-456',
        amount: 1000,
      });

      mockSession.updateMany.mockResolvedValue({ count: 1 });

      const response = await request(app).get('/api/v1/dodopayments/checkout/session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        session_id: 'session-123',
        status: 'completed',
        payment_id: 'pay-123',
        subscription_id: 'sub-456',
        amount: 1000,
      });

      expect(mockSession.updateMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-123' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          paymentId: 'pay-123',
          subscriptionId: 'sub-456',
          completedAt: expect.any(Date),
        }),
      });
    });

    it('should not update when checkout has no status', async () => {
      mockCheckoutSessions.retrieve.mockResolvedValue({
        session_id: 'session-123',
        amount: 1000,
      });

      const response = await request(app).get('/api/v1/dodopayments/checkout/session-123');

      expect(response.status).toBe(200);
      expect(mockSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/dodopayments/session/:sessionId', () => {
    it('should return session details with user and payment info', async () => {
      const mockDate = new Date('2024-01-15T10:00:00Z');
      mockSession.findFirst.mockResolvedValue({
        sessionId: 'session-123',
        status: 'COMPLETED',
        mode: 'SUBSCRIPTION',
        requestedTier: 'PRO',
        paymentId: 'pay-123',
        subscriptionId: 'sub-456',
        createdDate: mockDate,
        completedAt: mockDate,
        user: {
          email: 'test@example.com',
          userUuid: 'user-uuid-123',
          activeTier: 'PRO',
          tierExpiresAt: mockDate,
        },
        payments: [
          {
            id: 'payment-1',
            dodoPaymentId: 'pay-123',
            status: 'COMPLETED',
            amountCents: 1000,
            currency: 'USD',
          },
        ],
      });

      const response = await request(app).get('/api/v1/dodopayments/session/session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        session_id: 'session-123',
        status: 'COMPLETED',
        mode: 'SUBSCRIPTION',
        requested_tier: 'PRO',
        payment_id: 'pay-123',
        subscription_id: 'sub-456',
        created_date: mockDate.toISOString(),
        completed_at: mockDate.toISOString(),
        user: {
          email: 'test@example.com',
          user_uuid: 'user-uuid-123',
          active_tier: 'PRO',
          tier_expires_at: mockDate.toISOString(),
        },
        latest_payment: expect.objectContaining({
          dodoPaymentId: 'pay-123',
          status: 'COMPLETED',
        }),
      });
    });

    it('should return 404 when session not found', async () => {
      mockSession.findFirst.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/dodopayments/session/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Session not found',
      });
    });
  });

  describe('POST /api/v1/dodopayments/sync-session/:sessionId', () => {
    it('should sync session and update all related records', async () => {
      mockSession.findUnique.mockResolvedValue({
        sessionId: 'session-123',
        userUuid: 'user-uuid-123',
        requestedTier: 'PRO',
        completedAt: null,
        user: {
          email: 'test@example.com',
          userUuid: 'user-uuid-123',
        },
      });

      mockCheckoutSessions.retrieve.mockResolvedValue({
        session_id: 'session-123',
        status: 'completed',
        payment_id: 'pay-123',
        subscription_id: 'sub-456',
        product_cart: [{ product_id: 'prod_pro_monthly', quantity: 1 }],
      });

      mockSession.update.mockResolvedValue({});
      mockPayment.upsert.mockResolvedValue({});
      mockUserMapping.update.mockResolvedValue({});

      const response = await request(app).post('/api/v1/dodopayments/sync-session/session-123');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        session_id: 'session-123',
        session_updated: true,
        payment_upserted: true,
        user_tier_updated: true,
      });

      // Verify payment was upserted
      expect(mockPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dodoPaymentId: 'pay-123' },
          create: expect.objectContaining({
            dodoPaymentId: 'pay-123',
            userUuid: 'user-uuid-123',
            status: 'COMPLETED',
          }),
        })
      );

      // Verify user tier was updated
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { userUuid: 'user-uuid-123' },
        data: expect.objectContaining({
          activeTier: 'PRO',
        }),
      });
    });

    it('should return 404 when session not found', async () => {
      mockSession.findUnique.mockResolvedValue(null);

      const response = await request(app).post('/api/v1/dodopayments/sync-session/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Session not found in database',
      });
    });
  });

  describe('POST /api/v1/dodopayments/webhook', () => {
    beforeEach(() => {
      delete process.env.NODE_ENV;
    });

    it('should process payment.succeeded webhook and update user tier', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
        dodoCustomerId: null,
      });

      mockPayment.upsert.mockResolvedValue({});
      mockUserMapping.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: {
          payment_id: 'pay-123',
          total_amount: 1000,
          currency: 'USD',
          metadata: {
            user_uuid: 'user-uuid-123',
            requested_tier: 'PRO',
          },
          customer: {
            customer_id: 'cust-123',
            email: 'test@example.com',
          },
          product_cart: [{ product_id: 'prod_pro_monthly', quantity: 1 }],
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });

      // Verify payment was upserted
      expect(mockPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dodoPaymentId: 'pay-123' },
          create: expect.objectContaining({
            dodoPaymentId: 'pay-123',
            userUuid: 'user-uuid-123',
            status: 'COMPLETED',
            tier: 'PRO',
          }),
        })
      );

      // Verify user tier was updated
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { userUuid: 'user-uuid-123' },
        data: expect.objectContaining({
          activeTier: 'PRO',
        }),
      });
    });

    it('should process subscription.cancelled and set tier to FREE', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
      });

      mockUserMapping.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'subscription.cancelled',
        data: {
          subscription_id: 'sub-123',
          metadata: {
            user_uuid: 'user-uuid-123',
          },
          cancelled_at: '2024-01-15T10:00:00Z',
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);

      // Verify user tier was set to FREE
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { userUuid: 'user-uuid-123' },
        data: expect.objectContaining({
          activeTier: 'FREE',
        }),
      });
    });

    it('should verify signature and process valid webhook', async () => {
      const secretKey = 'dGVzdF9zZWNyZXRfa2V5'; // base64 encoded
      process.env.DODO_PAYMENTS_WEBHOOK_KEY = `whsec_${secretKey}`;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
      });
      mockPayment.upsert.mockResolvedValue({});
      mockUserMapping.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: {
          payment_id: 'pay-123',
          metadata: {
            user_uuid: 'user-uuid-123',
            requested_tier: 'PRO',
          },
        },
      };

      const webhookId = 'wh-123';
      const webhookTimestamp = Math.floor(Date.now() / 1000).toString();
      const rawPayload = JSON.stringify(webhookPayload);
      const signedMessage = `${webhookId}.${webhookTimestamp}.${rawPayload}`;

      const computedSignature = crypto
        .createHmac('sha256', Buffer.from(secretKey, 'base64'))
        .update(signedMessage, 'utf8')
        .digest('base64');

      const response = await request(app)
        .post('/api/v1/dodopayments/webhook')
        .set('webhook-id', webhookId)
        .set('webhook-timestamp', webhookTimestamp)
        .set('webhook-signature', `v1,${computedSignature}`)
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });

    it('should reject invalid signature in production', async () => {
      process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdF9rZXk=';
      process.env.NODE_ENV = 'production';

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: { payment_id: 'pay-123' },
      };

      const response = await request(app)
        .post('/api/v1/dodopayments/webhook')
        .set('webhook-id', 'wh-123')
        .set('webhook-timestamp', '1234567890')
        .set('webhook-signature', 'v1,invalid_signature')
        .send(webhookPayload);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid signature' });
    });

    it('should handle duplicate payment webhooks (idempotent upsert)', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
      });
      mockPayment.upsert.mockResolvedValue({});
      mockUserMapping.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: {
          payment_id: 'pay-123',
          metadata: { user_uuid: 'user-uuid-123', requested_tier: 'PRO' },
        },
      };

      // Send same webhook twice
      await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);
      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      // Upsert handles duplicates gracefully
      expect(mockPayment.upsert).toHaveBeenCalledTimes(2);
    });

    it('should process payment.failed webhook', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
      });
      mockPayment.upsert.mockResolvedValue({});
      mockSession.updateMany.mockResolvedValue({ count: 1 });

      const webhookPayload = {
        event_type: 'payment.failed',
        data: {
          payment_id: 'pay-123',
          total_amount: 1000,
          currency: 'USD',
          metadata: {
            user_uuid: 'user-uuid-123',
            session_id: 'session-123',
          },
          customer: {
            email: 'test@example.com',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dodoPaymentId: 'pay-123' },
          create: expect.objectContaining({
            status: 'FAILED',
          }),
        })
      );
    });

    it('should process subscription.created webhook', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
        dodoCustomerId: null,
      });
      mockUserMapping.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'subscription.created',
        data: {
          subscription_id: 'sub-123',
          status: 'active',
          product_id: 'prod_pro_monthly',
          expires_at: '2025-02-15T00:00:00Z',
          metadata: {
            user_uuid: 'user-uuid-123',
          },
          customer: {
            customer_id: 'cust-123',
            email: 'test@example.com',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockUserMapping.update).toHaveBeenCalled();
    });

    it('should process subscription.active webhook', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
        dodoCustomerId: null,
      });
      mockUserMapping.update.mockResolvedValue({});
      mockSession.findFirst.mockResolvedValue({
        id: 'db-1',
        sessionId: 'session-123',
        userUuid: 'user-uuid-123',
        status: 'PENDING',
      });
      mockSession.update.mockResolvedValue({});
      mockPayment.upsert.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'subscription.active',
        data: {
          subscription_id: 'sub-123',
          status: 'active',
          product_id: 'prod_pro_monthly',
          expires_at: '2025-02-15T00:00:00Z',
          recurring_pre_tax_amount: 1000,
          currency: 'USD',
          metadata: {
            user_uuid: 'user-uuid-123',
            requested_tier: 'PRO',
          },
          customer: {
            customer_id: 'cust-123',
            email: 'test@example.com',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { userUuid: 'user-uuid-123' },
        data: expect.objectContaining({
          activeTier: 'PRO',
        }),
      });
    });

    it('should process subscription.updated webhook', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
        dodoCustomerId: 'cust-123',
        tierExpiresAt: new Date('2025-01-15T00:00:00Z'),
      });
      mockUserMapping.update.mockResolvedValue({});
      mockSession.findFirst.mockResolvedValue(null);

      const webhookPayload = {
        event_type: 'subscription.updated',
        data: {
          subscription_id: 'sub-123',
          status: 'active',
          product_id: 'prod_pro_monthly',
          expires_at: '2025-02-15T00:00:00Z',
          metadata: {
            user_uuid: 'user-uuid-123',
          },
          customer: {
            customer_id: 'cust-123',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockUserMapping.update).toHaveBeenCalled();
    });

    it('should process subscription.renewed webhook', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
        dodoCustomerId: 'cust-123',
        activeTier: 'PRO',
        tierExpiresAt: new Date('2025-01-15T00:00:00Z'),
      });
      mockUserMapping.update.mockResolvedValue({});
      mockSession.findFirst.mockResolvedValue({
        id: 'db-1',
        sessionId: 'session-123',
        subscriptionId: 'sub-123',
        expiresAt: new Date('2025-01-15T00:00:00Z'),
      });
      mockSession.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'subscription.renewed',
        data: {
          subscription_id: 'sub-123',
          product_id: 'prod_pro_monthly',
          expires_at: '2025-02-15T00:00:00Z',
          metadata: {
            user_uuid: 'user-uuid-123',
          },
          customer: {
            customer_id: 'cust-123',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { userUuid: 'user-uuid-123' },
        data: expect.objectContaining({
          activeTier: 'PRO',
        }),
      });
    });

    it('should process subscription.expired webhook', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
      });
      mockUserMapping.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'subscription.expired',
        data: {
          subscription_id: 'sub-123',
          metadata: {
            user_uuid: 'user-uuid-123',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { userUuid: 'user-uuid-123' },
        data: expect.objectContaining({
          activeTier: 'FREE',
        }),
      });
    });

    it('should process customer.created webhook', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      // Import the mocked module
      const webhookUtils = await import('../../utils/webhookUtils');

      const webhookPayload = {
        event_type: 'customer.created',
        data: {
          customer_id: 'cust-123',
          email: 'test@example.com',
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(webhookUtils.WebhookUtils.handleCustomerCreated).toHaveBeenCalled();
    });

    it('should handle unhandled webhook event types gracefully', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      const webhookPayload = {
        event_type: 'unknown.event',
        data: {
          some_field: 'some_value',
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });

    it('should handle webhook with no event type', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      const webhookPayload = {
        data: {
          payment_id: 'pay-123',
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true, error: 'No event type found' });
    });

    it('should find user by email when userUuid not in metadata (payment.succeeded)', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique
        .mockResolvedValueOnce(null) // First call with userUuid
        .mockResolvedValueOnce({
          userUuid: 'user-uuid-123',
          email: 'test@example.com',
        }); // Second call with email

      mockPayment.upsert.mockResolvedValue({});
      mockUserMapping.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: {
          payment_id: 'pay-123',
          metadata: {
            customer_email: 'test@example.com',
          },
          product_cart: [{ product_id: 'prod_pro_monthly', quantity: 1 }],
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
    });

    it('should handle missing webhook headers', async () => {
      process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdF9rZXk=';

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: { payment_id: 'pay-123' },
      };

      // No headers set - should fail in production
      process.env.NODE_ENV = 'production';

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(401);
    });

    it('should handle payment.succeeded with session_id in metadata', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
      });
      mockPayment.upsert.mockResolvedValue({});
      mockPayment.update.mockResolvedValue({});
      mockUserMapping.update.mockResolvedValue({});
      mockSession.updateMany.mockResolvedValue({ count: 1 });

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: {
          payment_id: 'pay-123',
          metadata: {
            user_uuid: 'user-uuid-123',
            session_id: 'session-123',
            requested_tier: 'PRO',
          },
          product_cart: [{ product_id: 'prod_pro_monthly', quantity: 1 }],
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockSession.updateMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-123' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          paymentId: 'pay-123',
        }),
      });
    });

    it('should handle subscription.active when no pending session found but existing session with subscription_id exists', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
        dodoCustomerId: 'cust-123',
      });
      mockUserMapping.update.mockResolvedValue({});

      // First findFirst for pending session returns null
      // Second findFirst for existing session with subscription_id
      mockSession.findFirst
        .mockResolvedValueOnce(null) // No pending session
        .mockResolvedValueOnce({
          id: 'db-1',
          sessionId: 'session-123',
          subscriptionId: 'sub-123',
          completedAt: new Date('2025-01-10T00:00:00Z'),
        }); // Existing session

      mockSession.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'subscription.active',
        data: {
          subscription_id: 'sub-123',
          product_id: 'prod_pro_monthly',
          expires_at: '2025-02-15T00:00:00Z',
          metadata: {
            user_uuid: 'user-uuid-123',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
    });

    it('should handle subscription.updated with cancelled status', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
      });
      mockUserMapping.update.mockResolvedValue({});
      mockSession.findFirst.mockResolvedValue({
        id: 'db-1',
        sessionId: 'session-123',
        subscriptionId: 'sub-123',
        status: 'COMPLETED',
        expiresAt: new Date('2025-01-15T00:00:00Z'),
      });
      mockSession.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'subscription.updated',
        data: {
          subscription_id: 'sub-123',
          status: 'cancelled',
          cancelled_at: '2025-01-12T00:00:00Z',
          metadata: {
            user_uuid: 'user-uuid-123',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { userUuid: 'user-uuid-123' },
        data: expect.objectContaining({
          activeTier: 'FREE',
        }),
      });
    });

    it('should handle subscription.renewed without tier in metadata', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
        activeTier: 'BASIC',
        tierExpiresAt: new Date('2025-01-15T00:00:00Z'),
      });
      mockUserMapping.update.mockResolvedValue({});
      mockSession.findFirst.mockResolvedValue(null);

      const webhookPayload = {
        event_type: 'subscription.renewed',
        data: {
          subscription_id: 'sub-123',
          expires_at: '2025-02-15T00:00:00Z',
          metadata: {
            user_uuid: 'user-uuid-123',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      // Should use existing tier 'BASIC'
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { userUuid: 'user-uuid-123' },
        data: expect.objectContaining({
          activeTier: 'BASIC',
        }),
      });
    });

    it('should handle subscription.canceled (American spelling)', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue({
        userUuid: 'user-uuid-123',
        email: 'test@example.com',
      });
      mockUserMapping.update.mockResolvedValue({});

      const webhookPayload = {
        event_type: 'subscription.canceled',
        data: {
          subscription_id: 'sub-123',
          metadata: {
            user_uuid: 'user-uuid-123',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { userUuid: 'user-uuid-123' },
        data: expect.objectContaining({
          activeTier: 'FREE',
        }),
      });
    });

    it('should handle user not found in webhook processing', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      mockUserMapping.findUnique.mockResolvedValue(null);

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: {
          payment_id: 'pay-123',
          metadata: {
            user_uuid: 'nonexistent-user',
          },
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockPayment.upsert).not.toHaveBeenCalled();
    });
  });
});
