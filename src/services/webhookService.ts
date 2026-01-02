import { PrismaClient, Prisma, WebhookEvent } from '@prisma/client';
import { Logger } from '../types';
import crypto from 'crypto';

export interface CreateWebhookEventInput {
  tenantId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
}

export class WebhookService {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger
  ) {}

  async createEvent(input: CreateWebhookEventInput): Promise<WebhookEvent> {
    this.logger.info('Creating webhook event', { eventType: input.eventType });

    const event = await this.prisma.webhookEvent.create({
      data: {
        tenantId: input.tenantId,
        eventType: input.eventType,
        payload: input.payload,
        status: 'pending',
      },
    });

    // Trigger delivery asynchronously
    this.deliverWebhook(event.id).catch((error) => {
      this.logger.error('Webhook delivery failed', { eventId: event.id, error });
    });

    return event;
  }

  async deliverWebhook(eventId: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: eventId },
      include: { tenant: true },
    });

    if (!event || !event.tenant.webhookUrl) {
      this.logger.warn('Webhook event or tenant webhook URL not found', { eventId });
      return;
    }

    const { tenant } = event;

    try {
      const payload = JSON.stringify({
        id: event.id,
        event_type: event.eventType,
        tenant_id: event.tenantId,
        created_at: event.createdAt.toISOString(),
        data: event.payload,
      });

      // Generate signature
      const signature = this.generateSignature(payload, tenant.webhookSecret || '');

      // Send webhook
      const response = await fetch(tenant.webhookUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Subscription-Signature': signature,
        },
        body: payload,
      });

      if (response.ok) {
        await this.prisma.webhookEvent.update({
          where: { id: eventId },
          data: {
            status: 'delivered',
            deliveredAt: new Date(),
            deliveryAttempts: event.deliveryAttempts + 1,
            lastAttemptAt: new Date(),
          },
        });

        this.logger.info('Webhook delivered successfully', { eventId });
      } else {
        throw new Error(`Webhook delivery failed with status ${response.status}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          status: 'failed',
          errorMessage,
          deliveryAttempts: event.deliveryAttempts + 1,
          lastAttemptAt: new Date(),
        },
      });

      this.logger.error('Webhook delivery failed', { eventId, error: errorMessage });

      // Retry logic (max 3 attempts)
      if (event.deliveryAttempts < 3) {
        // Schedule retry after delay
        setTimeout(
          () => {
            this.deliverWebhook(eventId).catch(() => {});
          },
          Math.pow(2, event.deliveryAttempts) * 1000
        ); // Exponential backoff
      }
    }
  }

  private generateSignature(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  async getFailedWebhooks(tenantId: string): Promise<WebhookEvent[]> {
    return this.prisma.webhookEvent.findMany({
      where: {
        tenantId,
        status: 'failed',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async retryFailedWebhook(eventId: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: eventId },
    });

    if (!event || event.status !== 'failed') {
      throw new Error('Event not found or not in failed status');
    }

    await this.deliverWebhook(eventId);
  }
}
