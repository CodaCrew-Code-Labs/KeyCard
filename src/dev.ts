import 'dotenv/config';
import { createSubscriptionBackend } from './server';
import { Request } from 'express';
import { DodoPaymentsService } from './services/dodoPaymentsService';

async function startDev(): Promise<void> {
  try {
    // Validate required environment variable
    const apiKey = process.env.DODO_PAYMENTS_API_KEY;
    if (!apiKey) {
      throw new Error('DODO_PAYMENTS_API_KEY environment variable is required');
    }

    // Initialize DodoPayments client
    const client = DodoPaymentsService.initialize(apiKey, 'test_mode');

    // Test checkout session creation
    try {
      const checkoutSessionResponse = await client.checkoutSessions.create({
        product_cart: [{ product_id: 'product_id', quantity: 1 }],
      });
      console.log('✅ DodoPayments initialized. Session ID:', checkoutSessionResponse.session_id);
    } catch (error) {
      console.log(
        '✅ DodoPayments client initialized (test creation failed - expected in dev):',
        error instanceof Error ? error.message : String(error)
      );
    }

    await createSubscriptionBackend({
      port: 4000,
      database: {
        url: process.env.DATABASE_URL || 'postgresql://devuser:devpass@localhost:5432/devdb',
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
