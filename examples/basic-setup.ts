/**
 * Basic setup example for KeyCard Subscription Backend
 */

import express from 'express';
import { createSubscriptionBackend } from '../src';

async function main() {
  // Create your main Express app
  const app = express();

  // Add your main app routes
  app.get('/', (req, res) => {
    res.json({ message: 'Main application' });
  });

  // Example auth service (replace with your actual implementation)
  const yourAuthService = {
    verify: async (token: string) => {
      // Verify JWT token and return user info
      // This is a mock implementation
      return {
        id: 'user_123',
        tenantId: 'tenant_abc',
        email: 'user@example.com',
      };
    },
  };

  // Initialize subscription backend
  const subscriptionBackend = await createSubscriptionBackend({
    port: 4000,

    // Database configuration
    database: {
      url: process.env.DATABASE_URL || 'postgresql://localhost:5432/subscriptions',
    },

    // Payment provider configuration
    payment: {
      provider: 'dodo_payments',
      config: {
        apiKey: process.env.DODO_API_KEY || 'test_key',
        apiSecret: process.env.DODO_API_SECRET || 'test_secret',
        merchantId: process.env.DODO_MERCHANT_ID || 'merchant_123',
      },
    },

    // Authentication configuration
    auth: {
      validateRequest: async (req) => {
        try {
          const token = req.headers.authorization?.replace('Bearer ', '');
          if (!token) {
            return { userId: '', tenantId: '', isValid: false };
          }

          const user = await yourAuthService.verify(token);
          return {
            userId: user.id,
            tenantId: user.tenantId,
            isValid: true,
          };
        } catch {
          return { userId: '', tenantId: '', isValid: false };
        }
      },
    },

    // Optional features
    features: {
      autoMigration: true,
      webhooks: true,
      analytics: true,
    },

    // CORS configuration
    cors: {
      origin: ['http://localhost:3000', 'http://localhost:3001'],
      credentials: true,
    },

    // Rate limiting
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100,
    },

    // Lifecycle hooks
    hooks: {
      onSubscriptionCreated: async (subscription) => {
        console.log('New subscription created:', subscription.id);
        // Send welcome email, track analytics, etc.
      },

      onPaymentFailed: async (payment, subscription) => {
        console.log('Payment failed for subscription:', subscription?.id);
        // Send notification to user
      },

      onSubscriptionCanceled: async (subscription) => {
        console.log('Subscription canceled:', subscription.id);
        // Update user permissions, send feedback survey, etc.
      },
    },
  });

  // Start your main app on port 3000
  app.listen(3000, () => {
    console.log('Main app listening on http://localhost:3000');
  });

  // Subscription backend is automatically running on port 4000
  console.log('Subscription backend listening on http://localhost:4000');

  // Example: Programmatic usage
  setTimeout(async () => {
    try {
      // Create a subscription plan programmatically
      const plan = await subscriptionBackend.services.plans.create({
        tenantId: 'tenant_abc',
        name: 'Starter Plan',
        pricingModel: 'flat',
        amount: 19.99,
        currency: 'USD',
        billingInterval: 'month',
        features: {
          maxUsers: 5,
          storageGb: 10,
          apiCallsPerMonth: 10000,
        },
      });

      console.log('Created plan:', plan.id);

      // Get MRR analytics
      const mrr = await subscriptionBackend.services.analytics.getMRR('tenant_abc');
      console.log('Current MRR:', mrr.currentMrr);
    } catch (error) {
      console.error('Error:', error);
    }
  }, 5000); // Wait 5 seconds after startup
}

// Run the example
main().catch(console.error);
