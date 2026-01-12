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

  describe('handleCustomerCreated', () => {
    it('should update customer ID when both email and customer_id are present', async () => {
      mockUserMapping.findUnique.mockResolvedValue({
        email: 'customer@example.com',
        userUuid: 'uuid-123',
        dodoCustomerId: null,
      });
      mockUserMapping.update.mockResolvedValue({});

      await WebhookUtils.handleCustomerCreated({
        email: 'customer@example.com',
        customer_id: 'cust-123',
      });

      expect(mockUserMapping.findUnique).toHaveBeenCalledWith({
        where: { email: 'customer@example.com' },
      });
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { email: 'customer@example.com' },
        data: { dodoCustomerId: 'cust-123' },
      });
    });

    it('should not update customer ID if email is missing', async () => {
      await WebhookUtils.handleCustomerCreated({
        customer_id: 'cust-123',
      });

      expect(mockUserMapping.findUnique).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        'Missing customer_id or email in customer.created event'
      );
    });

    it('should not update customer ID if customer_id is missing', async () => {
      await WebhookUtils.handleCustomerCreated({
        email: 'customer@example.com',
      });

      expect(mockUserMapping.findUnique).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        'Missing customer_id or email in customer.created event'
      );
    });

    it('should handle errors gracefully', async () => {
      mockUserMapping.findUnique.mockRejectedValue(new Error('Database connection error'));

      await WebhookUtils.handleCustomerCreated({
        email: 'customer@example.com',
        customer_id: 'cust-123',
      });

      // Should not throw, just log the error
      expect(console.error).toHaveBeenCalledWith(
        'Error updating dodo_customer_id:',
        expect.any(Error)
      );
    });
  });

  describe('findUser', () => {
    it('should find user by userUuid', async () => {
      const mockUser = {
        email: 'test@example.com',
        userUuid: 'uuid-123',
        dodoCustomerId: null,
      };
      mockUserMapping.findUnique.mockResolvedValue(mockUser);

      const result = await WebhookUtils.findUser('uuid-123');

      expect(result).toEqual(mockUser);
      expect(mockUserMapping.findUnique).toHaveBeenCalledWith({
        where: { userUuid: 'uuid-123' },
      });
    });

    it('should find user by email when userUuid not found', async () => {
      const mockUser = {
        email: 'test@example.com',
        userUuid: 'uuid-123',
        dodoCustomerId: null,
      };
      mockUserMapping.findUnique
        .mockResolvedValueOnce(null) // First call with userUuid returns null
        .mockResolvedValueOnce(mockUser); // Second call with email returns user

      const result = await WebhookUtils.findUser('unknown-uuid', 'test@example.com');

      expect(result).toEqual(mockUser);
      expect(mockUserMapping.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should return null when neither userUuid nor email provided', async () => {
      const result = await WebhookUtils.findUser(undefined, undefined);

      expect(result).toBeNull();
      expect(mockUserMapping.findUnique).not.toHaveBeenCalled();
    });

    it('should return null when user not found by either method', async () => {
      mockUserMapping.findUnique.mockResolvedValue(null);

      const result = await WebhookUtils.findUser('unknown-uuid', 'unknown@example.com');

      expect(result).toBeNull();
    });
  });
});
