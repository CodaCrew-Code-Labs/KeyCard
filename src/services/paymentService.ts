import { PrismaClient, Payment, PaymentStatus } from '@prisma/client';
import { Logger, PaymentAdapter, PaginationParams, PaginationResult, SubscriptionError, LifecycleHooks } from '../types';

export interface CreatePaymentInput {
  tenantId: string;
  userId: string;
  invoiceId?: string;
  amount: number;
  currency: string;
  paymentMethod?: string;
  metadata?: Record<string, any>;
}

export interface RefundPaymentInput {
  amount?: number;
  reason?: string;
}

export interface ListPaymentsFilters extends PaginationParams {
  userId?: string;
  invoiceId?: string;
  status?: PaymentStatus;
}

export class PaymentService {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger,
    private paymentAdapter: PaymentAdapter,
    private hooks?: LifecycleHooks
  ) {}

  async create(input: CreatePaymentInput): Promise<Payment> {
    this.logger.info('Creating payment', { userId: input.userId, amount: input.amount });

    try {
      // Process payment through payment adapter
      const paymentResult = await this.paymentAdapter.createPayment({
        amount: input.amount,
        currency: input.currency,
        customerId: input.userId,
        metadata: input.metadata,
      });

      const payment = await this.prisma.payment.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          invoiceId: input.invoiceId,
          amount: input.amount,
          currency: input.currency,
          status: paymentResult.status,
          paymentProvider: this.paymentAdapter.name,
          providerPaymentId: paymentResult.paymentId,
          paymentMethodDetails: {},
          metadata: input.metadata || {},
        },
      });

      this.logger.info('Payment created', { paymentId: payment.id, status: payment.status });

      // If payment succeeded and linked to invoice, mark invoice as paid
      if (payment.status === 'succeeded' && input.invoiceId) {
        await this.prisma.invoice.update({
          where: { id: input.invoiceId },
          data: {
            status: 'paid',
            amountPaid: input.amount,
            paidAt: new Date(),
          },
        });
      }

      // Trigger hooks
      if (payment.status === 'succeeded' && this.hooks?.onPaymentSucceeded) {
        const subscription = input.invoiceId
          ? await this.prisma.subscription.findFirst({
              where: { invoices: { some: { id: input.invoiceId } } },
            })
          : null;
        await this.hooks.onPaymentSucceeded(payment, subscription);
      }

      if (payment.status === 'failed' && this.hooks?.onPaymentFailed) {
        const subscription = input.invoiceId
          ? await this.prisma.subscription.findFirst({
              where: { invoices: { some: { id: input.invoiceId } } },
            })
          : null;
        await this.hooks.onPaymentFailed(payment, subscription);
      }

      return payment;
    } catch (error) {
      this.logger.error('Payment creation failed', error);

      // Create failed payment record
      const payment = await this.prisma.payment.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          invoiceId: input.invoiceId,
          amount: input.amount,
          currency: input.currency,
          status: 'failed',
          paymentProvider: this.paymentAdapter.name,
          failureReason: error instanceof Error ? error.message : 'Unknown error',
          metadata: input.metadata || {},
        },
      });

      throw new SubscriptionError(
        'payment_failed',
        'Payment processing failed',
        402,
        { paymentId: payment.id }
      );
    }
  }

  async findById(id: string, tenantId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      include: { invoice: true },
    });

    if (!payment) {
      throw new SubscriptionError('resource_not_found', 'Payment not found', 404);
    }

    return payment;
  }

  async list(
    tenantId: string,
    filters: ListPaymentsFilters = {}
  ): Promise<PaginationResult<Payment>> {
    const { page = 1, limit = 20, userId, invoiceId, status } = filters;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (userId) where.userId = userId;
    if (invoiceId) where.invoiceId = invoiceId;
    if (status) where.status = status;

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data: payments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async refund(id: string, tenantId: string, input: RefundPaymentInput): Promise<Payment> {
    const payment = await this.findById(id, tenantId);

    if (payment.status !== 'succeeded') {
      throw new SubscriptionError(
        'validation_error',
        'Only successful payments can be refunded',
        400
      );
    }

    if (!payment.providerPaymentId) {
      throw new SubscriptionError(
        'validation_error',
        'Payment does not have a provider payment ID',
        400
      );
    }

    const refundAmount = input.amount || Number(payment.amount);

    this.logger.info('Refunding payment', { paymentId: id, amount: refundAmount });

    try {
      await this.paymentAdapter.refundPayment({
        paymentId: payment.providerPaymentId,
        amount: refundAmount,
        reason: input.reason,
      });

      const updatedPayment = await this.prisma.payment.update({
        where: { id },
        data: {
          status: 'refunded',
          refundedAmount: refundAmount,
        },
      });

      this.logger.info('Payment refunded', { paymentId: id });

      return updatedPayment;
    } catch (error) {
      this.logger.error('Refund failed', error);
      throw new SubscriptionError('payment_failed', 'Refund processing failed', 402);
    }
  }
}
