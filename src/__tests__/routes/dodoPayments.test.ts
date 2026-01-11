import express, { Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';

// Create shared mock objects that will be used by both the mock and tests
const mockUserMapping = {
  findUnique: jest.fn(),
  updateMany: jest.fn(),
};

const mockSession = {
  create: jest.fn(),
  findFirst: jest.fn(),
  updateMany: jest.fn(),
};

// Mock PrismaClient - use factory function with shared mocks
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    userMapping: mockUserMapping,
    session: mockSession,
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
const mockProcessWebhook = jest.fn();
jest.mock('../../utils/webhookUtils', () => ({
  WebhookUtils: {
    processWebhook: mockProcessWebhook,
  },
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
    mockUserMapping.updateMany.mockReset();
    mockSession.create.mockReset();
    mockSession.findFirst.mockReset();
    mockSession.updateMany.mockReset();
    mockCheckoutSessions.create.mockReset();
    mockCheckoutSessions.retrieve.mockReset();
    mockProcessWebhook.mockReset();

    // Reset environment
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('POST /api/v1/dodopayments/subscribe', () => {
    it('should create checkout session for new user without dodoCustomerId', async () => {
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
        sobCustomerId: 'user-uuid-123',
        status: 'created',
      });

      const response = await request(app).post('/api/v1/dodopayments/subscribe').send({
        product_id: 'prod-123',
        customer_email: 'test@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        session_url: 'https://checkout.example.com/session-123',
        session_id: 'session-123',
      });

      expect(mockCheckoutSessions.create).toHaveBeenCalledWith({
        product_cart: [{ product_id: 'prod-123', quantity: 1 }],
        return_url: 'http://stayonbrand.in',
        customer: { email: 'test@example.com' },
        metadata: { customer_email: 'test@example.com' },
      });
    });

    it('should create checkout session for existing user with dodoCustomerId', async () => {
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
        sobCustomerId: 'user-uuid-123',
        status: 'created',
      });

      const response = await request(app).post('/api/v1/dodopayments/subscribe').send({
        product_id: 'prod-123',
        customer_email: 'test@example.com',
      });

      expect(response.status).toBe(200);
      expect(mockCheckoutSessions.create).toHaveBeenCalledWith({
        product_cart: [{ product_id: 'prod-123', quantity: 1 }],
        return_url: 'http://stayonbrand.in',
        customer: { customer_id: 'dodo-cust-456' },
        metadata: { dodo_customer_id: 'dodo-cust-456' },
      });
    });

    it('should create checkout session for user not in database', async () => {
      mockUserMapping.findUnique.mockResolvedValue(null);

      mockCheckoutSessions.create.mockResolvedValue({
        session_id: 'session-123',
        checkout_url: 'https://checkout.example.com/session-123',
      });

      const response = await request(app).post('/api/v1/dodopayments/subscribe').send({
        product_id: 'prod-123',
        customer_email: 'newuser@example.com',
      });

      expect(response.status).toBe(200);
      // Should not create session in DB since user doesn't exist
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

    it('should handle DodoPayments API errors', async () => {
      mockUserMapping.findUnique.mockResolvedValue(null);
      mockCheckoutSessions.create.mockRejectedValue(new Error('API Error'));

      const response = await request(app).post('/api/v1/dodopayments/subscribe').send({
        product_id: 'prod-123',
        customer_email: 'test@example.com',
      });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/v1/dodopayments/checkout/:id', () => {
    it('should retrieve checkout session and update status', async () => {
      mockCheckoutSessions.retrieve.mockResolvedValue({
        session_id: 'session-123',
        status: 'completed',
        amount: 1000,
      });

      mockSession.updateMany.mockResolvedValue({ count: 1 });

      const response = await request(app).get('/api/v1/dodopayments/checkout/session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        session_id: 'session-123',
        status: 'completed',
        amount: 1000,
      });

      expect(mockCheckoutSessions.retrieve).toHaveBeenCalledWith('session-123');
    });

    it('should not update status if checkout has no status', async () => {
      mockCheckoutSessions.retrieve.mockResolvedValue({
        session_id: 'session-123',
        amount: 1000,
      });

      const response = await request(app).get('/api/v1/dodopayments/checkout/session-123');

      expect(response.status).toBe(200);
      expect(mockSession.updateMany).not.toHaveBeenCalled();
    });

    it('should handle DodoPayments API errors', async () => {
      mockCheckoutSessions.retrieve.mockRejectedValue(new Error('Not found'));

      const response = await request(app).get('/api/v1/dodopayments/checkout/invalid-session');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/v1/dodopayments/session/:sessionId', () => {
    it('should return session details from database', async () => {
      const mockDate = new Date('2024-01-15T10:00:00Z');
      mockSession.findFirst.mockResolvedValue({
        sessionId: 'session-123',
        status: 'completed',
        createdAt: mockDate,
        user: {
          email: 'test@example.com',
          userUuid: 'user-uuid-123',
        },
      });

      const response = await request(app).get('/api/v1/dodopayments/session/session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        session_id: 'session-123',
        status: 'completed',
        created_date: mockDate.toISOString(),
        user: {
          email: 'test@example.com',
          sob_id: 'user-uuid-123',
        },
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

    it('should handle database errors', async () => {
      mockSession.findFirst.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/v1/dodopayments/session/session-123');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/v1/dodopayments/webhook', () => {
    it('should process webhook without signature verification when key not configured', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: { payment_id: 'pay-123' },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      expect(mockProcessWebhook).toHaveBeenCalledWith(webhookPayload);
    });

    it('should process webhook without headers when headers missing', async () => {
      process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_test_secret_key';

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: { payment_id: 'pay-123' },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      expect(mockProcessWebhook).toHaveBeenCalledWith(webhookPayload);
    });

    it('should verify signature and process valid webhook', async () => {
      const secretKey = 'dGVzdF9zZWNyZXRfa2V5'; // base64 encoded "test_secret_key"
      process.env.DODO_PAYMENTS_WEBHOOK_KEY = `whsec_${secretKey}`;

      const webhookPayload = {
        event_type: 'subscription.created',
        data: {
          customer: {
            email: 'test@example.com',
            customer_id: 'cust-123',
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

      mockUserMapping.updateMany.mockResolvedValue({ count: 1 });

      const response = await request(app)
        .post('/api/v1/dodopayments/webhook')
        .set('webhook-id', webhookId)
        .set('webhook-timestamp', webhookTimestamp)
        .set('webhook-signature', `v1,${computedSignature}`)
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      expect(mockProcessWebhook).toHaveBeenCalledWith(webhookPayload);
    });

    it('should process webhook with warning when signature does not match', async () => {
      process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdF9rZXk=';

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

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        received: true,
        warning: 'Processed without signature verification',
      });
      expect(mockProcessWebhook).toHaveBeenCalledWith(webhookPayload);
    });

    it('should update customer ID from subscription webhook', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      const webhookPayload = {
        event_type: 'subscription.created',
        data: {
          customer: {
            email: 'test@example.com',
            customer_id: 'cust-123',
          },
        },
      };

      mockUserMapping.updateMany.mockResolvedValue({ count: 1 });

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
    });

    it('should not update customer ID for non-subscription events', async () => {
      delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

      const webhookPayload = {
        event_type: 'payment.succeeded',
        data: {
          payment_id: 'pay-123',
        },
      };

      const response = await request(app).post('/api/v1/dodopayments/webhook').send(webhookPayload);

      expect(response.status).toBe(200);
      expect(mockUserMapping.updateMany).not.toHaveBeenCalled();
    });
  });
});
