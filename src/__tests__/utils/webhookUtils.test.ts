// Create shared mock objects
const mockUserMapping = {
  findUnique: jest.fn(),
  update: jest.fn(),
};

// Mock getPrismaClient from database/client
jest.mock('../../database/client', () => ({
  getPrismaClient: jest.fn(() => ({
    userMapping: mockUserMapping,
  })),
}));

// Import after mocks
import { WebhookUtils } from '../../utils/webhookUtils';

describe('WebhookUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console.log for cleaner test output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('updateDodoCustomerId', () => {
    it('should update dodo_customer_id for existing user without one', async () => {
      mockUserMapping.findUnique.mockResolvedValue({
        email: 'test@example.com',
        userUuid: 'uuid-123',
        dodoCustomerId: null,
      });
      mockUserMapping.update.mockResolvedValue({
        email: 'test@example.com',
        userUuid: 'uuid-123',
        dodoCustomerId: 'dodo-456',
      });

      const result = await WebhookUtils.updateDodoCustomerId('test@example.com', 'dodo-456');

      expect(result).toBe(true);
      expect(mockUserMapping.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        data: { dodoCustomerId: 'dodo-456' },
      });
    });

    it('should return false when user not found', async () => {
      mockUserMapping.findUnique.mockResolvedValue(null);

      const result = await WebhookUtils.updateDodoCustomerId('nonexistent@example.com', 'dodo-456');

      expect(result).toBe(false);
      expect(mockUserMapping.update).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('User not found for email: nonexistent@example.com');
    });

    it('should return false when user already has dodo_customer_id', async () => {
      mockUserMapping.findUnique.mockResolvedValue({
        email: 'test@example.com',
        userUuid: 'uuid-123',
        dodoCustomerId: 'existing-dodo-id',
      });

      const result = await WebhookUtils.updateDodoCustomerId('test@example.com', 'new-dodo-id');

      expect(result).toBe(false);
      expect(mockUserMapping.update).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        'User test@example.com already has dodo_customer_id: existing-dodo-id'
      );
    });

    it('should return false and log error on database error', async () => {
      mockUserMapping.findUnique.mockRejectedValue(new Error('Database error'));

      const result = await WebhookUtils.updateDodoCustomerId('test@example.com', 'dodo-456');

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        'Error updating dodo_customer_id:',
        expect.any(Error)
      );
    });
  });

  describe('processWebhook', () => {
    it('should handle customer.created event', async () => {
      mockUserMapping.findUnique.mockResolvedValue({
        email: 'customer@example.com',
        userUuid: 'uuid-123',
        dodoCustomerId: null,
      });
      mockUserMapping.update.mockResolvedValue({});

      await WebhookUtils.processWebhook({
        event_type: 'customer.created',
        data: {
          email: 'customer@example.com',
          customer_id: 'cust-123',
        },
      });

      expect(mockUserMapping.findUnique).toHaveBeenCalledWith({
        where: { email: 'customer@example.com' },
      });
      expect(console.log).toHaveBeenCalledWith('Processing webhook event: customer.created');
    });

    it('should handle payment.succeeded event', async () => {
      await WebhookUtils.processWebhook({
        event_type: 'payment.succeeded',
        data: {
          payment_id: 'pay-123',
          amount: 1000,
        },
      });

      expect(console.log).toHaveBeenCalledWith('Processing webhook event: payment.succeeded');
      expect(console.log).toHaveBeenCalledWith('Payment succeeded:', {
        payment_id: 'pay-123',
        amount: 1000,
      });
    });

    it('should handle subscription.created event', async () => {
      await WebhookUtils.processWebhook({
        event_type: 'subscription.created',
        data: {
          subscription_id: 'sub-123',
        },
      });

      expect(console.log).toHaveBeenCalledWith('Processing webhook event: subscription.created');
      expect(console.log).toHaveBeenCalledWith('Subscription created:', {
        subscription_id: 'sub-123',
      });
    });

    it('should log unhandled event types', async () => {
      await WebhookUtils.processWebhook({
        event_type: 'unknown.event',
        data: {},
      });

      expect(console.log).toHaveBeenCalledWith('Processing webhook event: unknown.event');
      expect(console.log).toHaveBeenCalledWith('Unhandled webhook event: unknown.event');
    });

    it('should handle missing event_type', async () => {
      await WebhookUtils.processWebhook({
        event_type: 'unknown.event',
        data: {},
      });

      expect(console.log).toHaveBeenCalledWith('Processing webhook event: unknown.event');
      expect(console.log).toHaveBeenCalledWith('Unhandled webhook event: unknown.event');
    });

    it('should handle errors during webhook processing', async () => {
      mockUserMapping.findUnique.mockRejectedValue(new Error('Database connection error'));

      await WebhookUtils.processWebhook({
        event_type: 'customer.created',
        data: {
          email: 'customer@example.com',
          customer_id: 'cust-123',
        },
      });

      // Should not throw, just log the error
      expect(console.error).toHaveBeenCalledWith(
        'Error updating dodo_customer_id:',
        expect.any(Error)
      );
    });

    it('should not update customer ID if email is missing', async () => {
      await WebhookUtils.processWebhook({
        event_type: 'customer.created',
        data: {
          customer_id: 'cust-123',
        },
      });

      expect(mockUserMapping.findUnique).not.toHaveBeenCalled();
    });

    it('should not update customer ID if customer_id is missing', async () => {
      await WebhookUtils.processWebhook({
        event_type: 'customer.created',
        data: {
          email: 'customer@example.com',
        },
      });

      expect(mockUserMapping.findUnique).not.toHaveBeenCalled();
    });
  });
});
