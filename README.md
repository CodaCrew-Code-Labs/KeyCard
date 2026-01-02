# KeyCard Subscription Backend

A plug-and-play NPM package that provides a complete subscription management backend for SaaS applications. Import the package, configure it with minimal settings (DB credentials, subscription plans, port), and get a fully functional subscription API running on a separate port.

## Features

- ✅ **Zero-config deployment**: Install, configure, and run on a separate port
- ✅ **Multi-tenant ready**: Automatic tenant isolation with shared database
- ✅ **Flexible pricing**: Flat, tiered, per-seat, and usage-based billing
- ✅ **Payment integration**: Extensible payment adapter system (DoDo Payments included)
- ✅ **Comprehensive API**: REST endpoints + programmatic access
- ✅ **Analytics built-in**: MRR, churn, revenue tracking
- ✅ **Production features**: Webhooks, dunning, proration, invoicing
- ✅ **Type-safe**: Full TypeScript support
- ✅ **Bring-your-own-auth**: Integrates with your existing authentication system

## Installation

```bash
npm install @keycard/subscription-backend
```

## Quick Start

```typescript
import { createSubscriptionBackend } from '@keycard/subscription-backend';
import express from 'express';

const app = express();

// Your main application routes
app.get('/', (req, res) => res.send('Main app'));

// Initialize subscription backend
const subscriptionBackend = await createSubscriptionBackend({
  port: 4000,
  database: {
    url: process.env.DATABASE_URL,
  },
  payment: {
    provider: 'dodo_payments',
    config: {
      apiKey: process.env.DODO_API_KEY,
      apiSecret: process.env.DODO_API_SECRET,
      merchantId: process.env.DODO_MERCHANT_ID,
    },
  },
  auth: {
    validateRequest: async (req) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const user = await yourAuthService.verify(token);
      return {
        userId: user.id,
        tenantId: user.tenantId,
        isValid: !!user,
      };
    },
  },
});

// Start main app
app.listen(3000, () => console.log('Main app on 3000'));
// Subscription backend automatically runs on port 4000
```

## Configuration

### Database Configuration

```typescript
{
  database: {
    // Option 1: Connection URL
    url: 'postgresql://user:password@localhost:5432/mydb',

    // Option 2: Individual parameters
    host: 'localhost',
    port: 5432,
    database: 'myapp_subscriptions',
    username: 'postgres',
    password: 'password',
    ssl: false,
    poolSize: 10,
  }
}
```

### Payment Provider Configuration

```typescript
{
  payment: {
    provider: 'dodo_payments',
    config: {
      apiKey: process.env.DODO_API_KEY,
      apiSecret: process.env.DODO_API_SECRET,
      merchantId: process.env.DODO_MERCHANT_ID,
    },
    // Optional: Custom payment processor
    customProcessor: {
      createPayment: async (params) => { /* ... */ },
      refundPayment: async (params) => { /* ... */ },
      verifyWebhook: (params) => { /* ... */ },
      processWebhook: async (payload) => { /* ... */ },
    },
  }
}
```

### Lifecycle Hooks

```typescript
{
  hooks: {
    onSubscriptionCreated: async (subscription) => {
      await yourAnalytics.track('subscription_created', subscription);
    },
    onPaymentFailed: async (payment, subscription) => {
      await yourNotificationService.send(subscription.userId, 'payment_failed');
    },
    onSubscriptionCanceled: async (subscription) => {
      await yourCRM.updateCustomer(subscription.userId, { status: 'churned' });
    },
  }
}
```

## API Endpoints

All endpoints are available at `http://localhost:{port}/api/v1`

### Subscription Plans

- `POST /plans` - Create a subscription plan
- `GET /plans` - List all plans
- `GET /plans/:id` - Get plan details
- `PATCH /plans/:id` - Update a plan
- `DELETE /plans/:id` - Delete a plan (soft delete)

### Subscriptions

- `POST /subscriptions` - Create a subscription
- `GET /subscriptions` - List subscriptions
- `GET /subscriptions/:id` - Get subscription details
- `PATCH /subscriptions/:id` - Update subscription
- `POST /subscriptions/:id/cancel` - Cancel subscription
- `POST /subscriptions/:id/pause` - Pause subscription
- `POST /subscriptions/:id/resume` - Resume subscription

### Invoices

- `GET /invoices` - List invoices
- `GET /invoices/:id` - Get invoice details
- `POST /invoices/:id/pay` - Manually trigger payment

### Payments

- `GET /payments` - List payments
- `GET /payments/:id` - Get payment details
- `POST /payments/:id/refund` - Refund a payment

### Usage Tracking

- `POST /usage` - Record usage
- `GET /usage` - Get usage records

### Analytics

- `GET /analytics/mrr` - Get Monthly Recurring Revenue
- `GET /analytics/churn` - Get churn metrics
- `GET /analytics/revenue` - Get revenue breakdown

## Usage Examples

### Creating a Subscription Plan

```bash
curl -X POST http://localhost:4000/api/v1/plans \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pro Plan",
    "pricing_model": "flat",
    "amount": 49.99,
    "currency": "USD",
    "billing_interval": "month",
    "trial_period_days": 14,
    "features": {
      "max_users": 10,
      "storage_gb": 100,
      "api_calls_per_month": 100000
    }
  }'
```

### Subscribing a User

```bash
curl -X POST http://localhost:4000/api/v1/subscriptions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_123",
    "plan_id": "plan_abc123"
  }'
```

### Recording Usage (for usage-based billing)

```bash
curl -X POST http://localhost:4000/api/v1/usage \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subscription_id": "sub_xyz789",
    "metric_name": "api_calls",
    "quantity": 150
  }'
```

## Programmatic API

Instead of HTTP requests, use the package programmatically:

```typescript
const backend = await createSubscriptionBackend({ /* config */ });

// Create a plan
const plan = await backend.services.plans.create({
  tenantId: 'tenant_xyz',
  name: 'Enterprise',
  pricingModel: 'flat',
  amount: 199.99,
  currency: 'USD',
  billingInterval: 'month',
});

// Subscribe a user
const subscription = await backend.services.subscriptions.create({
  tenantId: 'tenant_xyz',
  userId: 'user_456',
  planId: plan.id,
  quantity: 5,
});

// Check subscription status
const isActive = await backend.services.subscriptions.isActive('sub_xyz789');

// Get MRR analytics
const mrr = await backend.services.analytics.getMRR('tenant_xyz');
console.log(`Current MRR: $${mrr.currentMrr}`);
```

## Database Setup

1. Create a PostgreSQL database
2. Set the `DATABASE_URL` environment variable
3. Run Prisma migrations:

```bash
npx prisma migrate deploy
```

## Running Tests

```bash
npm test
npm run test:coverage
```

## Environment Variables

Create a `.env` file:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/subscriptions
DODO_API_KEY=your_api_key
DODO_API_SECRET=your_api_secret
DODO_MERCHANT_ID=your_merchant_id
```

## Multi-Tenancy

The package automatically isolates data by `tenant_id`. Every database query is filtered by the tenant ID from the authenticated request.

```typescript
auth: {
  validateRequest: async (req) => {
    const user = await yourAuthService.verify(req.headers.authorization);
    return {
      userId: user.id,
      tenantId: user.organization.id, // Tenant isolation
      isValid: true,
    };
  }
}
```

## Webhooks

Configure webhooks to receive events when important things happen:

```typescript
// In your app
app.post('/webhooks/subscription', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-subscription-signature'];
  const event = JSON.parse(req.body.toString());

  // Verify signature
  const isValid = verifyWebhookSignature(
    req.body.toString(),
    signature,
    process.env.WEBHOOK_SECRET
  );

  if (!isValid) return res.status(401).send('Invalid signature');

  // Handle events
  switch (event.event_type) {
    case 'subscription.canceled':
      await revokeUserAccess(event.data.user_id);
      break;
    case 'invoice.payment_failed':
      await notifyUser(event.data.user_id, 'payment_failed');
      break;
  }

  res.json({ received: true });
});
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

MIT

## Support

For issues and questions, please open an issue on GitHub or contact support@keycard.com
