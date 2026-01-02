#!/usr/bin/env node

/**
 * Development server for testing the subscription backend
 */

import { createSubscriptionBackend } from './server';
import { createLogger } from './utils/logger';

const logger = createLogger();

// Mock auth service for development
const mockAuthService = {
  verify: async (token: string) => {
    // In development, accept any token and return a test user
    logger.info('Mock auth - accepting token:', token);
    return {
      id: 'user_dev_123',
      tenantId: 'tenant_dev_abc',
      email: 'dev@example.com',
    };
  },
};

async function startDevServer() {
  try {
    logger.info('Starting development server...');

    const backend = await createSubscriptionBackend({
      port: Number(process.env.PORT) || 4000,

      database: {
        url:
          process.env.DATABASE_URL ||
          'postgresql://postgres:postgres@localhost:5432/subscriptions',
      },

      payment: {
        provider: 'dodo_payments',
        config: {
          apiKey: process.env.DODO_API_KEY || 'dev_api_key',
          apiSecret: process.env.DODO_API_SECRET || 'dev_api_secret',
          merchantId: process.env.DODO_MERCHANT_ID || 'dev_merchant_123',
        },
      },

      auth: {
        validateRequest: async (req) => {
          try {
            const token = req.headers.authorization?.replace('Bearer ', '');

            if (!token) {
              logger.warn('No authorization token provided');
              return { userId: '', tenantId: '', isValid: false };
            }

            const user = await mockAuthService.verify(token);
            return {
              userId: user.id,
              tenantId: user.tenantId,
              isValid: true,
            };
          } catch (error) {
            logger.error('Auth validation failed:', error);
            return { userId: '', tenantId: '', isValid: false };
          }
        },
      },

      features: {
        autoMigration: true,
        webhooks: true,
        analytics: true,
      },

      cors: {
        origin: ['http://localhost:3000', 'http://localhost:3001'],
        credentials: true,
      },

      rateLimit: {
        windowMs: 15 * 60 * 1000,
        max: 100,
      },

      hooks: {
        onSubscriptionCreated: async (subscription) => {
          logger.info('🎉 Subscription created:', {
            id: subscription.id,
            userId: subscription.userId,
            planId: subscription.planId,
          });
        },

        onPaymentSucceeded: async (payment) => {
          logger.info('💰 Payment succeeded:', {
            id: payment.id,
            amount: payment.amount,
            currency: payment.currency,
          });
        },

        onPaymentFailed: async (payment) => {
          logger.error('❌ Payment failed:', {
            id: payment.id,
            amount: payment.amount,
            reason: payment.failureReason,
          });
        },

        onSubscriptionCanceled: async (subscription) => {
          logger.info('🚫 Subscription canceled:', {
            id: subscription.id,
            userId: subscription.userId,
          });
        },
      },
    });

    logger.info('✅ Development server is running!');
    logger.info(`📡 API available at: http://localhost:${process.env.PORT || 4000}/api/v1`);
    logger.info(`🏥 Health check: http://localhost:${process.env.PORT || 4000}/api/v1/health`);
    logger.info('');
    logger.info('💡 Example requests:');
    logger.info('   Create plan: POST /api/v1/plans');
    logger.info('   List plans: GET /api/v1/plans');
    logger.info('   Create subscription: POST /api/v1/subscriptions');
    logger.info('');
    logger.info('🔑 Use any Bearer token for authentication (mock auth enabled)');
    logger.info('   Example: -H "Authorization: Bearer test-token"');
    logger.info('');
    logger.info('Press Ctrl+C to stop the server');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('\n👋 Shutting down gracefully...');
      await backend.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('\n👋 Shutting down gracefully...');
      await backend.stop();
      process.exit(0);
    });
  } catch (error) {
    logger.error('❌ Failed to start development server:', error);
    process.exit(1);
  }
}

// Start the server
startDevServer();
