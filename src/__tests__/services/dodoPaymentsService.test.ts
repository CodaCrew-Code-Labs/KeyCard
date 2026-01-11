import DodoPayments from 'dodopayments';
import { DodoPaymentsService } from '../../services/dodoPaymentsService';

// Mock DodoPayments
jest.mock('dodopayments');

describe('DodoPaymentsService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset the singleton instance before each test
    interface MockDodoPaymentsService {
      instance: unknown;
    }
    (DodoPaymentsService as unknown as MockDodoPaymentsService).instance = null;

    // Reset environment variables
    process.env = { ...originalEnv };
    delete process.env.DODO_PAYMENTS_ENVIRONMENT;
    delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;

    // Clear mock
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('initialize', () => {
    it('should create a new DodoPayments instance with provided config', () => {
      const mockClient = { checkoutSessions: {} };
      (DodoPayments as unknown as jest.Mock).mockImplementation(() => mockClient);

      const result = DodoPaymentsService.initialize('test-api-key', 'test_mode', 'webhook-key');

      expect(DodoPayments).toHaveBeenCalledWith({
        bearerToken: 'test-api-key',
        environment: 'test_mode',
        webhookKey: 'webhook-key',
      });
      expect(result).toBe(mockClient);
    });

    it('should use environment variables when available', () => {
      process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode';
      process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'env-webhook-key';

      const mockClient = { checkoutSessions: {} };
      (DodoPayments as unknown as jest.Mock).mockImplementation(() => mockClient);

      DodoPaymentsService.initialize('test-api-key');

      expect(DodoPayments).toHaveBeenCalledWith({
        bearerToken: 'test-api-key',
        environment: 'live_mode',
        webhookKey: 'env-webhook-key',
      });
    });

    it('should return existing instance on subsequent calls (singleton)', () => {
      const mockClient = { checkoutSessions: {} };
      (DodoPayments as unknown as jest.Mock).mockImplementation(() => mockClient);

      const first = DodoPaymentsService.initialize('key1', 'test_mode');
      const second = DodoPaymentsService.initialize('key2', 'live_mode');

      expect(first).toBe(second);
      expect(DodoPayments).toHaveBeenCalledTimes(1);
    });

    it('should use default test_mode when no environment specified', () => {
      const mockClient = { checkoutSessions: {} };
      (DodoPayments as unknown as jest.Mock).mockImplementation(() => mockClient);

      DodoPaymentsService.initialize('test-api-key');

      expect(DodoPayments).toHaveBeenCalledWith({
        bearerToken: 'test-api-key',
        environment: 'test_mode',
        webhookKey: undefined,
      });
    });

    it('should prefer env vars over passed parameters', () => {
      process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode';
      process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'env-key';

      const mockClient = { checkoutSessions: {} };
      (DodoPayments as unknown as jest.Mock).mockImplementation(() => mockClient);

      DodoPaymentsService.initialize('api-key', 'test_mode', 'param-key');

      expect(DodoPayments).toHaveBeenCalledWith({
        bearerToken: 'api-key',
        environment: 'live_mode', // env var wins
        webhookKey: 'env-key', // env var wins
      });
    });
  });

  describe('getClient', () => {
    it('should return the initialized client', () => {
      const mockClient = { checkoutSessions: { create: jest.fn() } };
      (DodoPayments as unknown as jest.Mock).mockImplementation(() => mockClient);

      DodoPaymentsService.initialize('test-api-key');
      const client = DodoPaymentsService.getClient();

      expect(client).toBe(mockClient);
    });

    it('should throw error when client is not initialized', () => {
      expect(() => DodoPaymentsService.getClient()).toThrow(
        'DodoPayments client not initialized. Call initialize() first.'
      );
    });
  });
});
