import { PrismaClient } from '@prisma/client';
import { PlanService } from '../planService';
import { createLogger } from '../../utils/logger';

// Mock Prisma Client
const mockPrisma = {
  subscriptionPlan: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  subscription: {
    count: jest.fn(),
  },
} as unknown as PrismaClient;

const logger = createLogger();

describe('PlanService', () => {
  let planService: PlanService;

  beforeEach(() => {
    planService = new PlanService(mockPrisma, logger);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a subscription plan', async () => {
      const mockPlan = {
        id: 'plan-123',
        tenantId: 'tenant-1',
        name: 'Pro Plan',
        pricingModel: 'flat',
        amount: 49.99,
        currency: 'USD',
        billingInterval: 'month',
        billingIntervalCount: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.subscriptionPlan.create as jest.Mock).mockResolvedValue(mockPlan);

      const result = await planService.create({
        tenantId: 'tenant-1',
        name: 'Pro Plan',
        pricingModel: 'flat',
        amount: 49.99,
        currency: 'USD',
        billingInterval: 'month',
      });

      expect(result).toEqual(mockPlan);
      expect(mockPrisma.subscriptionPlan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          name: 'Pro Plan',
          amount: 49.99,
        }),
      });
    });
  });

  describe('findById', () => {
    it('should find a plan by ID', async () => {
      const mockPlan = {
        id: 'plan-123',
        tenantId: 'tenant-1',
        name: 'Pro Plan',
      };

      (mockPrisma.subscriptionPlan.findFirst as jest.Mock).mockResolvedValue(mockPlan);

      const result = await planService.findById('plan-123', 'tenant-1');

      expect(result).toEqual(mockPlan);
      expect(mockPrisma.subscriptionPlan.findFirst).toHaveBeenCalledWith({
        where: { id: 'plan-123', tenantId: 'tenant-1' },
      });
    });

    it('should throw error if plan not found', async () => {
      (mockPrisma.subscriptionPlan.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(planService.findById('plan-123', 'tenant-1')).rejects.toThrow(
        'Subscription plan not found'
      );
    });
  });

  describe('list', () => {
    it('should list plans with pagination', async () => {
      const mockPlans = [
        { id: 'plan-1', name: 'Basic' },
        { id: 'plan-2', name: 'Pro' },
      ];

      (mockPrisma.subscriptionPlan.findMany as jest.Mock).mockResolvedValue(mockPlans);
      (mockPrisma.subscriptionPlan.count as jest.Mock).mockResolvedValue(2);

      const result = await planService.list('tenant-1', { page: 1, limit: 20 });

      expect(result.data).toEqual(mockPlans);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });
  });

  describe('update', () => {
    it('should update a plan', async () => {
      const mockPlan = {
        id: 'plan-123',
        tenantId: 'tenant-1',
        name: 'Pro Plan',
      };

      const updatedPlan = {
        ...mockPlan,
        name: 'Pro Plan Updated',
      };

      (mockPrisma.subscriptionPlan.findFirst as jest.Mock).mockResolvedValue(mockPlan);
      (mockPrisma.subscriptionPlan.update as jest.Mock).mockResolvedValue(updatedPlan);

      const result = await planService.update('plan-123', 'tenant-1', {
        name: 'Pro Plan Updated',
      });

      expect(result.name).toBe('Pro Plan Updated');
      expect(mockPrisma.subscriptionPlan.update).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should soft delete a plan', async () => {
      const mockPlan = {
        id: 'plan-123',
        tenantId: 'tenant-1',
        isActive: true,
      };

      (mockPrisma.subscriptionPlan.findFirst as jest.Mock).mockResolvedValue(mockPlan);
      (mockPrisma.subscriptionPlan.update as jest.Mock).mockResolvedValue({
        ...mockPlan,
        isActive: false,
      });

      await planService.delete('plan-123', 'tenant-1');

      expect(mockPrisma.subscriptionPlan.update).toHaveBeenCalledWith({
        where: { id: 'plan-123' },
        data: { isActive: false },
      });
    });
  });
});
