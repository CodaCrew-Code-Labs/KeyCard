import { PrismaClient, Subscription, SubscriptionStatus } from '@prisma/client';
import { Logger, PaginationParams, PaginationResult, SubscriptionError, LifecycleHooks } from '../types';
import { calculateNextBillingDate } from '../utils/proration';

export interface CreateSubscriptionInput {
  tenantId: string;
  userId: string;
  planId: string;
  quantity?: number;
  trialPeriodDays?: number;
  metadata?: Record<string, any>;
}

export interface UpdateSubscriptionInput {
  planId?: string;
  quantity?: number;
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
}

export interface CancelSubscriptionInput {
  cancelAtPeriodEnd?: boolean;
  reason?: string;
}

export interface PauseSubscriptionInput {
  resumeAt?: Date;
}

export interface ListSubscriptionsFilters extends PaginationParams {
  userId?: string;
  status?: SubscriptionStatus;
  planId?: string;
}

export class SubscriptionService {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger,
    private hooks?: LifecycleHooks
  ) {}

  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    this.logger.info('Creating subscription', { userId: input.userId, planId: input.planId });

    // Get plan details
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: input.planId },
    });

    if (!plan) {
      throw new SubscriptionError('resource_not_found', 'Subscription plan not found', 404);
    }

    if (!plan.isActive) {
      throw new SubscriptionError(
        'validation_error',
        'Cannot subscribe to an inactive plan',
        400
      );
    }

    // Check if user already has active subscription
    const existingSubscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        status: {
          in: ['active', 'trialing'],
        },
      },
    });

    if (existingSubscription) {
      throw new SubscriptionError(
        'validation_error',
        'User already has an active subscription',
        400
      );
    }

    const now = new Date();
    const trialPeriodDays = input.trialPeriodDays ?? plan.trialPeriodDays;

    let trialStart: Date | null = null;
    let trialEnd: Date | null = null;
    let status: SubscriptionStatus = 'active';

    // Set trial period if applicable
    if (trialPeriodDays && trialPeriodDays > 0) {
      trialStart = now;
      trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + trialPeriodDays);
      status = 'trialing';
    }

    // Calculate billing period
    const currentPeriodStart = trialEnd || now;
    const currentPeriodEnd = calculateNextBillingDate(
      currentPeriodStart,
      plan.billingInterval,
      plan.billingIntervalCount
    );

    const subscription = await this.prisma.subscription.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        planId: input.planId,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        trialStart,
        trialEnd,
        quantity: input.quantity || 1,
        metadata: input.metadata || {},
      },
      include: {
        plan: true,
      },
    });

    this.logger.info('Subscription created', { subscriptionId: subscription.id });

    // Trigger lifecycle hook
    if (this.hooks?.onSubscriptionCreated) {
      await this.hooks.onSubscriptionCreated(subscription);
    }

    return subscription;
  }

  async findById(id: string, tenantId: string): Promise<Subscription> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id, tenantId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new SubscriptionError(
        'resource_not_found',
        'Subscription not found',
        404,
        { subscriptionId: id }
      );
    }

    return subscription;
  }

  async list(
    tenantId: string,
    filters: ListSubscriptionsFilters = {}
  ): Promise<PaginationResult<Subscription>> {
    const { page = 1, limit = 20, userId, status, planId } = filters;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (userId) where.userId = userId;
    if (status) where.status = status;
    if (planId) where.planId = planId;

    const [subscriptions, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        skip,
        take: limit,
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return {
      data: subscriptions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async update(
    id: string,
    tenantId: string,
    input: UpdateSubscriptionInput
  ): Promise<Subscription> {
    const subscription = await this.findById(id, tenantId);

    this.logger.info('Updating subscription', { subscriptionId: id });

    const updateData: any = {};

    if (input.quantity !== undefined) {
      updateData.quantity = input.quantity;
    }

    // Handle plan change
    if (input.planId && input.planId !== subscription.planId) {
      const newPlan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: input.planId },
      });

      if (!newPlan) {
        throw new SubscriptionError('resource_not_found', 'New plan not found', 404);
      }

      updateData.planId = input.planId;

      // TODO: Implement proration logic based on prorationBehavior
      // For now, just update the plan
    }

    const updatedSubscription = await this.prisma.subscription.update({
      where: { id },
      data: updateData,
      include: { plan: true },
    });

    this.logger.info('Subscription updated', { subscriptionId: id });

    if (this.hooks?.onSubscriptionUpdated) {
      await this.hooks.onSubscriptionUpdated(updatedSubscription);
    }

    return updatedSubscription;
  }

  async cancel(
    id: string,
    tenantId: string,
    input: CancelSubscriptionInput
  ): Promise<Subscription> {
    const subscription = await this.findById(id, tenantId);

    if (subscription.status === 'canceled') {
      throw new SubscriptionError(
        'validation_error',
        'Subscription is already canceled',
        400
      );
    }

    this.logger.info('Canceling subscription', { subscriptionId: id });

    const updateData: any = {
      canceledAt: new Date(),
    };

    // If not canceling at period end, end immediately
    if (!input.cancelAtPeriodEnd) {
      updateData.status = 'canceled';
      updateData.endedAt = new Date();
    }

    const updatedSubscription = await this.prisma.subscription.update({
      where: { id },
      data: updateData,
      include: { plan: true },
    });

    this.logger.info('Subscription canceled', { subscriptionId: id });

    if (this.hooks?.onSubscriptionCanceled) {
      await this.hooks.onSubscriptionCanceled(updatedSubscription);
    }

    return updatedSubscription;
  }

  async pause(
    id: string,
    tenantId: string,
    input: PauseSubscriptionInput
  ): Promise<Subscription> {
    const subscription = await this.findById(id, tenantId);

    if (subscription.status !== 'active') {
      throw new SubscriptionError(
        'validation_error',
        'Only active subscriptions can be paused',
        400
      );
    }

    this.logger.info('Pausing subscription', { subscriptionId: id });

    const updatedSubscription = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: 'paused',
        metadata: {
          ...(subscription.metadata as object),
          pausedAt: new Date().toISOString(),
          resumeAt: input.resumeAt?.toISOString(),
        },
      },
      include: { plan: true },
    });

    this.logger.info('Subscription paused', { subscriptionId: id });

    return updatedSubscription;
  }

  async resume(id: string, tenantId: string): Promise<Subscription> {
    const subscription = await this.findById(id, tenantId);

    if (subscription.status !== 'paused') {
      throw new SubscriptionError(
        'validation_error',
        'Only paused subscriptions can be resumed',
        400
      );
    }

    this.logger.info('Resuming subscription', { subscriptionId: id });

    const updatedSubscription = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: 'active',
        metadata: {
          ...(subscription.metadata as object),
          resumedAt: new Date().toISOString(),
        },
      },
      include: { plan: true },
    });

    this.logger.info('Subscription resumed', { subscriptionId: id });

    return updatedSubscription;
  }

  async isActive(id: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });

    return subscription?.status === 'active' || subscription?.status === 'trialing';
  }

  async getActiveSubscriptionsCount(tenantId: string): Promise<number> {
    return this.prisma.subscription.count({
      where: {
        tenantId,
        status: {
          in: ['active', 'trialing'],
        },
      },
    });
  }
}
