import { PrismaClient } from '@prisma/client';
import { SubscriptionService } from '../subscriptionService';
import { createLogger } from '../../utils/logger';

const mockPrisma = {
  subscriptionPlan: {
    findUnique: jest.fn(),
  },
  subscription: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
} as unknown as PrismaClient;

const logger = createLogger();

describe('SubscriptionService', () => {
  let subscriptionService: SubscriptionService;

  beforeEach(() => {
    subscriptionService = new SubscriptionService(mockPrisma, logger);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a subscription with trial period', async () => {
      const mockPlan = {
        id: 'plan-123',
        name: 'Pro Plan',
        isActive: true,
        amount: 49.99,
        currency: 'USD',
        billingInterval: 'month',
        billingIntervalCount: 1,
        trialPeriodDays: 14,
      };

      const mockSubscription = {
        id: 'sub-123',
        tenantId: 'tenant-1',
        userId: 'user-1',
        planId: 'plan-123',
        status: 'trialing',
        quantity: 1,
        plan: mockPlan,
      };

      (mockPrisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.subscription.create as jest.Mock).mockResolvedValue(mockSubscription);

      const result = await subscriptionService.create({
        tenantId: 'tenant-1',
        userId: 'user-1',
        planId: 'plan-123',
      });

      expect(result.status).toBe('trialing');
      expect(mockPrisma.subscription.create).toHaveBeenCalled();
    });

    it('should throw error if plan not found', async () => {
      (mockPrisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        subscriptionService.create({
          tenantId: 'tenant-1',
          userId: 'user-1',
          planId: 'plan-123',
        })
      ).rejects.toThrow('Subscription plan not found');
    });

    it('should throw error if user already has active subscription', async () => {
      const mockPlan = {
        id: 'plan-123',
        isActive: true,
      };

      const existingSubscription = {
        id: 'sub-existing',
        status: 'active',
      };

      (mockPrisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(existingSubscription);

      await expect(
        subscriptionService.create({
          tenantId: 'tenant-1',
          userId: 'user-1',
          planId: 'plan-123',
        })
      ).rejects.toThrow('User already has an active subscription');
    });
  });

  describe('cancel', () => {
    it('should cancel subscription immediately', async () => {
      const mockSubscription = {
        id: 'sub-123',
        status: 'active',
        tenantId: 'tenant-1',
        plan: {},
      };

      const canceledSubscription = {
        ...mockSubscription,
        status: 'canceled',
        canceledAt: new Date(),
        endedAt: new Date(),
      };

      (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);
      (mockPrisma.subscription.update as jest.Mock).mockResolvedValue(canceledSubscription);

      const result = await subscriptionService.cancel('sub-123', 'tenant-1', {
        cancelAtPeriodEnd: false,
      });

      expect(result.status).toBe('canceled');
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-123' },
          data: expect.objectContaining({
            status: 'canceled',
          }),
        })
      );
    });

    it('should schedule cancellation at period end', async () => {
      const mockSubscription = {
        id: 'sub-123',
        status: 'active',
        tenantId: 'tenant-1',
        plan: {},
      };

      (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);
      (mockPrisma.subscription.update as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        canceledAt: new Date(),
      });

      await subscriptionService.cancel('sub-123', 'tenant-1', {
        cancelAtPeriodEnd: true,
      });

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            status: 'canceled',
          }),
        })
      );
    });
  });

  describe('pause and resume', () => {
    it('should pause an active subscription', async () => {
      const mockSubscription = {
        id: 'sub-123',
        status: 'active',
        tenantId: 'tenant-1',
        metadata: {},
        plan: {},
      };

      (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);
      (mockPrisma.subscription.update as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: 'paused',
      });

      const result = await subscriptionService.pause('sub-123', 'tenant-1', {});

      expect(result.status).toBe('paused');
    });

    it('should resume a paused subscription', async () => {
      const mockSubscription = {
        id: 'sub-123',
        status: 'paused',
        tenantId: 'tenant-1',
        metadata: {},
        plan: {},
      };

      (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);
      (mockPrisma.subscription.update as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: 'active',
      });

      const result = await subscriptionService.resume('sub-123', 'tenant-1');

      expect(result.status).toBe('active');
    });
  });
});
