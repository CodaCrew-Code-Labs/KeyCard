import 'dotenv/config';
import { createSubscriptionBackend } from './server';
import { Request } from 'express';

async function startDev(): Promise<void> {
  try {
    // Validate required environment variable
    const apiKey = process.env.DODO_PAYMENTS_API_KEY;
    if (!apiKey) {
      throw new Error('DODO_PAYMENTS_API_KEY environment variable is required');
    }

    await createSubscriptionBackend({
      port: 4000,
      database: {
        url: process.env.DATABASE_URL || 'postgresql://devuser:devpass@localhost:5432/devdb',
      },
      payment: {
        provider: 'dodo_payments',
        config: {
          apiKey: apiKey,
          environment: 'test_mode',
          webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
        },
      },
      auth: {
        validateRequest: async (_req: Request) => {
          return {
            userId: 'dev_user_123',
            tenantId: 'dev_tenant_123',
            isValid: true,
          };
        },
      },
    });

    console.log('🚀 Development server started on http://localhost:4000');
  } catch (error) {
    console.error('Failed to start development server:', error);
    process.exit(1);
  }
}

void startDev();
