import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { Logger } from '../types';
import { InvoiceService } from '../services/invoiceService';
import { PaymentService } from '../services/paymentService';
import { calculateNextBillingDate } from '../utils/proration';

export class BillingCycleJob {
  private cronJob: cron.ScheduledTask | null = null;

  constructor(
    private prisma: PrismaClient,
    private invoiceService: InvoiceService,
    private paymentService: PaymentService,
    private logger: Logger
  ) {}

  start(): void {
    // Run daily at midnight
    this.cronJob = cron.schedule('0 0 * * *', async () => {
      await this.processBillingCycles();
    });

    this.logger.info('Billing cycle job started');
  }

  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.logger.info('Billing cycle job stopped');
    }
  }

  private async processBillingCycles(): Promise<void> {
    this.logger.info('Processing billing cycles');

    try {
      const now = new Date();

      // Find subscriptions due for billing
      const subscriptions = await this.prisma.subscription.findMany({
        where: {
          status: 'active',
          currentPeriodEnd: {
            lte: now,
          },
        },
        include: {
          plan: true,
        },
      });

      this.logger.info(`Found ${subscriptions.length} subscriptions due for billing`);

      for (const subscription of subscriptions) {
        try {
          const { plan } = subscription;

          // Generate invoice
          const invoice = await this.invoiceService.create({
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            userId: subscription.userId,
            currency: plan.currency,
            subtotal: Number(plan.amount) * subscription.quantity,
            total: Number(plan.amount) * subscription.quantity,
            dueDate: new Date(),
            periodStart: subscription.currentPeriodStart,
            periodEnd: subscription.currentPeriodEnd,
            lineItems: [
              {
                description: `${plan.name} (${subscription.currentPeriodStart.toISOString().split('T')[0]} - ${subscription.currentPeriodEnd.toISOString().split('T')[0]})`,
                quantity: subscription.quantity,
                unitAmount: Number(plan.amount),
                amount: Number(plan.amount) * subscription.quantity,
              },
            ],
          });

          // Attempt payment
          await this.paymentService.create({
            tenantId: subscription.tenantId,
            userId: subscription.userId,
            invoiceId: invoice.id,
            amount: Number(invoice.total),
            currency: invoice.currency,
          });

          // Update subscription period
          const newPeriodStart = subscription.currentPeriodEnd;
          const newPeriodEnd = calculateNextBillingDate(
            newPeriodStart,
            plan.billingInterval,
            plan.billingIntervalCount
          );

          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              currentPeriodStart: newPeriodStart,
              currentPeriodEnd: newPeriodEnd,
            },
          });

          this.logger.info(`Billing processed for subscription ${subscription.id}`);
        } catch (error) {
          this.logger.error(`Failed to process billing for subscription ${subscription.id}`, error);

          // Mark subscription as past_due
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'past_due' },
          });
        }
      }
    } catch (error) {
      this.logger.error('Billing cycle processing failed', error);
    }
  }
}
