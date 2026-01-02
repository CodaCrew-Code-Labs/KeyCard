import { PrismaClient } from '@prisma/client';
import { Logger } from '../types';

export interface MRRBreakdown {
  planId: string;
  planName: string;
  mrr: number;
  subscriberCount: number;
}

export interface MRRResponse {
  currentMrr: number;
  previousMrr: number;
  growthRate: number;
  currency: string;
  breakdown: MRRBreakdown[];
}

export interface ChurnResponse {
  churnRate: number;
  churnedCustomers: number;
  totalCustomers: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface RevenueTimeline {
  date: string;
  revenue: number;
}

export interface RevenueResponse {
  totalRevenue: number;
  currency: string;
  timeline: RevenueTimeline[];
}

export class AnalyticsService {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger
  ) {}

  async getMRR(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    groupBy?: 'plan' | 'tenant'
  ): Promise<MRRResponse> {
    this.logger.info('Calculating MRR', { tenantId });

    // Get all active subscriptions
    const activeSubscriptions = await this.prisma.subscription.findMany({
      where: {
        tenantId,
        status: {
          in: ['active', 'trialing'],
        },
      },
      include: {
        plan: true,
      },
    });

    let currentMrr = 0;
    const breakdownMap = new Map<string, MRRBreakdown>();

    activeSubscriptions.forEach((subscription) => {
      const { plan, quantity } = subscription;
      const monthlyAmount = this.normalizeToMonthlyAmount(
        Number(plan.amount),
        plan.billingInterval,
        plan.billingIntervalCount
      );

      const subscriptionMrr = monthlyAmount * quantity;
      currentMrr += subscriptionMrr;

      // Group by plan
      if (!breakdownMap.has(plan.id)) {
        breakdownMap.set(plan.id, {
          planId: plan.id,
          planName: plan.name,
          mrr: 0,
          subscriberCount: 0,
        });
      }

      const breakdown = breakdownMap.get(plan.id)!;
      breakdown.mrr += subscriptionMrr;
      breakdown.subscriberCount += 1;
    });

    // Calculate previous month MRR (simplified - would need historical data)
    const previousMrr = currentMrr * 0.9; // Placeholder

    const growthRate = previousMrr > 0 ? ((currentMrr - previousMrr) / previousMrr) * 100 : 0;

    return {
      currentMrr: Math.round(currentMrr * 100) / 100,
      previousMrr: Math.round(previousMrr * 100) / 100,
      growthRate: Math.round(growthRate * 100) / 100,
      currency: 'USD',
      breakdown: Array.from(breakdownMap.values()),
    };
  }

  async getChurn(
    tenantId: string,
    period: 'month' | 'quarter' | 'year' = 'month'
  ): Promise<ChurnResponse> {
    this.logger.info('Calculating churn rate', { tenantId, period });

    const now = new Date();
    let periodStart = new Date();

    switch (period) {
      case 'month':
        periodStart.setMonth(now.getMonth() - 1);
        break;
      case 'quarter':
        periodStart.setMonth(now.getMonth() - 3);
        break;
      case 'year':
        periodStart.setFullYear(now.getFullYear() - 1);
        break;
    }

    // Get total customers at start of period
    const totalCustomers = await this.prisma.subscription.count({
      where: {
        tenantId,
        createdAt: {
          lte: periodStart,
        },
      },
    });

    // Get churned customers (canceled during period)
    const churnedCustomers = await this.prisma.subscription.count({
      where: {
        tenantId,
        status: 'canceled',
        canceledAt: {
          gte: periodStart,
          lte: now,
        },
      },
    });

    const churnRate = totalCustomers > 0 ? (churnedCustomers / totalCustomers) * 100 : 0;

    return {
      churnRate: Math.round(churnRate * 100) / 100,
      churnedCustomers,
      totalCustomers,
      periodStart,
      periodEnd: now,
    };
  }

  async getRevenue(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    groupBy: 'day' | 'week' | 'month' = 'day'
  ): Promise<RevenueResponse> {
    this.logger.info('Calculating revenue', { tenantId });

    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate || new Date();

    // Get all successful payments in period
    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        status: 'succeeded',
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const totalRevenue = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);

    // Group payments by date
    const timelineMap = new Map<string, number>();

    payments.forEach((payment) => {
      const dateKey = this.formatDateKey(payment.createdAt, groupBy);
      const current = timelineMap.get(dateKey) || 0;
      timelineMap.set(dateKey, current + Number(payment.amount));
    });

    const timeline: RevenueTimeline[] = Array.from(timelineMap.entries()).map(
      ([date, revenue]) => ({
        date,
        revenue: Math.round(revenue * 100) / 100,
      })
    );

    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      currency: 'USD',
      timeline,
    };
  }

  private normalizeToMonthlyAmount(
    amount: number,
    interval: string,
    intervalCount: number
  ): number {
    switch (interval) {
      case 'day':
        return (amount / intervalCount) * 30;
      case 'week':
        return (amount / intervalCount) * 4.33;
      case 'month':
        return amount / intervalCount;
      case 'year':
        return amount / (intervalCount * 12);
      default:
        return amount;
    }
  }

  private formatDateKey(date: Date, groupBy: 'day' | 'week' | 'month'): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    switch (groupBy) {
      case 'day':
        return `${year}-${month}-${day}`;
      case 'week':
        // ISO week calculation (simplified)
        const weekNum = Math.ceil(date.getDate() / 7);
        return `${year}-W${String(weekNum).padStart(2, '0')}`;
      case 'month':
        return `${year}-${month}`;
      default:
        return `${year}-${month}-${day}`;
    }
  }
}
