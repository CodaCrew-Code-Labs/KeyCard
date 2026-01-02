import { PrismaClient, Invoice, InvoiceStatus } from '@prisma/client';
import { Logger, PaginationParams, PaginationResult, SubscriptionError, LifecycleHooks } from '../types';
import { generateInvoiceNumber } from '../utils/proration';

export interface CreateInvoiceInput {
  tenantId: string;
  subscriptionId: string;
  userId: string;
  currency: string;
  taxAmount?: number;
  subtotal: number;
  total: number;
  dueDate: Date;
  periodStart: Date;
  periodEnd: Date;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    amount: number;
    proration?: boolean;
    metadata?: Record<string, any>;
  }>;
  metadata?: Record<string, any>;
}

export interface ListInvoicesFilters extends PaginationParams {
  userId?: string;
  subscriptionId?: string;
  status?: InvoiceStatus;
}

export class InvoiceService {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger,
    private hooks?: LifecycleHooks
  ) {}

  async create(input: CreateInvoiceInput): Promise<Invoice> {
    this.logger.info('Creating invoice', { subscriptionId: input.subscriptionId });

    const invoiceNumber = generateInvoiceNumber();
    const amountDue = input.total;

    const invoice = await this.prisma.invoice.create({
      data: {
        tenantId: input.tenantId,
        subscriptionId: input.subscriptionId,
        userId: input.userId,
        invoiceNumber,
        amountDue,
        amountPaid: 0,
        currency: input.currency,
        status: 'open',
        taxAmount: input.taxAmount || 0,
        subtotal: input.subtotal,
        total: input.total,
        dueDate: input.dueDate,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        metadata: input.metadata || {},
        lineItems: {
          create: input.lineItems.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitAmount: item.unitAmount,
            amount: item.amount,
            proration: item.proration || false,
            metadata: item.metadata || {},
          })),
        },
      },
      include: {
        lineItems: true,
        subscription: true,
      },
    });

    this.logger.info('Invoice created', { invoiceId: invoice.id });

    if (this.hooks?.onInvoiceGenerated) {
      await this.hooks.onInvoiceGenerated(invoice);
    }

    return invoice;
  }

  async findById(id: string, tenantId: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: {
        lineItems: true,
        subscription: {
          include: { plan: true },
        },
      },
    });

    if (!invoice) {
      throw new SubscriptionError('resource_not_found', 'Invoice not found', 404);
    }

    return invoice;
  }

  async list(
    tenantId: string,
    filters: ListInvoicesFilters = {}
  ): Promise<PaginationResult<Invoice>> {
    const { page = 1, limit = 20, userId, subscriptionId, status } = filters;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (userId) where.userId = userId;
    if (subscriptionId) where.subscriptionId = subscriptionId;
    if (status) where.status = status;

    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        include: { lineItems: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data: invoices,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async markAsPaid(id: string, tenantId: string, amountPaid: number): Promise<Invoice> {
    const invoice = await this.findById(id, tenantId);

    this.logger.info('Marking invoice as paid', { invoiceId: id });

    const updatedInvoice = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: 'paid',
        amountPaid,
        paidAt: new Date(),
      },
      include: { lineItems: true },
    });

    this.logger.info('Invoice marked as paid', { invoiceId: id });

    return updatedInvoice;
  }

  async markAsUncollectible(id: string, tenantId: string): Promise<Invoice> {
    const invoice = await this.findById(id, tenantId);

    this.logger.info('Marking invoice as uncollectible', { invoiceId: id });

    const updatedInvoice = await this.prisma.invoice.update({
      where: { id },
      data: { status: 'uncollectible' },
      include: { lineItems: true },
    });

    return updatedInvoice;
  }

  async voidInvoice(id: string, tenantId: string): Promise<Invoice> {
    const invoice = await this.findById(id, tenantId);

    if (invoice.status === 'paid') {
      throw new SubscriptionError(
        'validation_error',
        'Cannot void a paid invoice',
        400
      );
    }

    this.logger.info('Voiding invoice', { invoiceId: id });

    const updatedInvoice = await this.prisma.invoice.update({
      where: { id },
      data: { status: 'void' },
      include: { lineItems: true },
    });

    return updatedInvoice;
  }
}
