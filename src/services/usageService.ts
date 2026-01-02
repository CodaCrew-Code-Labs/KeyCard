import { PrismaClient, UsageRecord } from '@prisma/client';
import { Logger, PaginationParams, PaginationResult } from '../types';

export interface CreateUsageInput {
  tenantId: string;
  subscriptionId: string;
  userId: string;
  metricName: string;
  quantity: number;
  timestamp?: Date;
  metadata?: Record<string, any>;
}

export interface ListUsageFilters extends PaginationParams {
  subscriptionId: string;
  metricName?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface UsageSummary {
  totalQuantity: number;
  metricName: string;
  periodStart: Date;
  periodEnd: Date;
}

export class UsageService {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger
  ) {}

  async record(input: CreateUsageInput): Promise<UsageRecord> {
    this.logger.info('Recording usage', {
      subscriptionId: input.subscriptionId,
      metricName: input.metricName,
      quantity: input.quantity,
    });

    const usageRecord = await this.prisma.usageRecord.create({
      data: {
        tenantId: input.tenantId,
        subscriptionId: input.subscriptionId,
        userId: input.userId,
        metricName: input.metricName,
        quantity: input.quantity,
        timestamp: input.timestamp || new Date(),
        metadata: input.metadata || {},
      },
    });

    this.logger.info('Usage recorded', { usageRecordId: usageRecord.id });

    return usageRecord;
  }

  async list(
    tenantId: string,
    filters: ListUsageFilters
  ): Promise<PaginationResult<UsageRecord> & { summary: UsageSummary }> {
    const { page = 1, limit = 20, subscriptionId, metricName, startDate, endDate } = filters;
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      subscriptionId,
    };

    if (metricName) {
      where.metricName = metricName;
    }

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    const [records, total, aggregation] = await Promise.all([
      this.prisma.usageRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
      }),
      this.prisma.usageRecord.count({ where }),
      this.prisma.usageRecord.aggregate({
        where,
        _sum: { quantity: true },
      }),
    ]);

    const summary: UsageSummary = {
      totalQuantity: Number(aggregation._sum.quantity || 0),
      metricName: metricName || 'all',
      periodStart: startDate || new Date(0),
      periodEnd: endDate || new Date(),
    };

    return {
      data: records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary,
    };
  }

  async getTotalUsage(
    subscriptionId: string,
    metricName: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<number> {
    const where: any = {
      subscriptionId,
      metricName,
    };

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    const aggregation = await this.prisma.usageRecord.aggregate({
      where,
      _sum: { quantity: true },
    });

    return Number(aggregation._sum.quantity || 0);
  }
}
