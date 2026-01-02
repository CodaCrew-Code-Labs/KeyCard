import {
  PrismaClient,
  Prisma,
  SubscriptionPlan,
  PricingModel,
  BillingInterval,
} from '@prisma/client';
import { Logger, PaginationParams, PaginationResult, SubscriptionError } from '../types';

export interface CreatePlanInput {
  tenantId: string;
  name: string;
  description?: string;
  pricingModel: PricingModel;
  amount: number;
  currency?: string;
  billingInterval: BillingInterval;
  billingIntervalCount?: number;
  trialPeriodDays?: number;
  setupFee?: number;
  features?: Prisma.InputJsonValue;
}

export interface UpdatePlanInput {
  name?: string;
  description?: string;
  amount?: number;
  trialPeriodDays?: number;
  setupFee?: number;
  features?: Prisma.InputJsonValue;
  isActive?: boolean;
}

export interface ListPlansFilters extends PaginationParams {
  isActive?: boolean;
  pricingModel?: PricingModel;
}

export class PlanService {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger
  ) {}

  async create(input: CreatePlanInput): Promise<SubscriptionPlan> {
    this.logger.info('Creating subscription plan', { name: input.name });

    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        description: input.description,
        pricingModel: input.pricingModel,
        amount: input.amount,
        currency: input.currency || 'USD',
        billingInterval: input.billingInterval,
        billingIntervalCount: input.billingIntervalCount || 1,
        trialPeriodDays: input.trialPeriodDays,
        setupFee: input.setupFee,
        features: input.features || {},
      },
    });

    this.logger.info('Subscription plan created', { planId: plan.id });
    return plan;
  }

  async findById(id: string, tenantId: string): Promise<SubscriptionPlan> {
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!plan) {
      throw new SubscriptionError('resource_not_found', 'Subscription plan not found', 404, {
        planId: id,
      });
    }

    return plan;
  }

  async list(
    tenantId: string,
    filters: ListPlansFilters = {}
  ): Promise<PaginationResult<SubscriptionPlan>> {
    const { page = 1, limit = 20, isActive, pricingModel } = filters;
    const skip = (page - 1) * limit;

    const where: { tenantId: string; isActive?: boolean; pricingModel?: PricingModel } = {
      tenantId,
    };

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (pricingModel) {
      where.pricingModel = pricingModel;
    }

    const [plans, total] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscriptionPlan.count({ where }),
    ]);

    return {
      data: plans,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async update(id: string, tenantId: string, input: UpdatePlanInput): Promise<SubscriptionPlan> {
    // Verify plan exists and belongs to tenant
    await this.findById(id, tenantId);

    this.logger.info('Updating subscription plan', { planId: id });

    const plan = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: input,
    });

    this.logger.info('Subscription plan updated', { planId: id });
    return plan;
  }

  async delete(id: string, tenantId: string): Promise<void> {
    // Verify plan exists and belongs to tenant
    await this.findById(id, tenantId);

    this.logger.info('Deleting subscription plan (soft delete)', { planId: id });

    // Soft delete by setting isActive to false
    await this.prisma.subscriptionPlan.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.info('Subscription plan deleted', { planId: id });
  }

  async getActiveSubscriptionCount(planId: string): Promise<number> {
    return this.prisma.subscription.count({
      where: {
        planId,
        status: {
          in: ['active', 'trialing'],
        },
      },
    });
  }
}
