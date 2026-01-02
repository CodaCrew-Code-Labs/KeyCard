import 'dotenv/config';
import { createSubscriptionBackend } from './server';

async function startDev() {
  try {
    const backend = await createSubscriptionBackend({
      port: 4000,
      database: {
        url: process.env.DATABASE_URL || 'postgresql://devuser:devpass@localhost:5432/devdb',
      },
      payment: {
        provider: 'dodo_payments',
        config: {
          apiKey: process.env.DODO_API_KEY || 'dev_key',
          apiSecret: process.env.DODO_API_SECRET || 'dev_secret',
          merchantId: process.env.DODO_MERCHANT_ID || 'dev_merchant',
        },
      },
      auth: {
        validateRequest: async (req) => {
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

startDev();