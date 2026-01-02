# Quick Start Guide

Get your subscription backend up and running in 5 minutes!

## Prerequisites

- Node.js >= 18.0.0
- PostgreSQL database
- npm or yarn

## Step 1: Installation

```bash
npm install @keycard/subscription-backend
# or
yarn add @keycard/subscription-backend
```

## Step 2: Database Setup

1. Create a PostgreSQL database:

```sql
CREATE DATABASE subscriptions;
```

2. Set up environment variables in `.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/subscriptions
DODO_API_KEY=your_api_key
DODO_API_SECRET=your_api_secret
DODO_MERCHANT_ID=your_merchant_id
```

3. Run Prisma migrations:

```bash
npx prisma migrate deploy
```

## Step 3: Initialize the Backend

Create `server.ts`:

```typescript
import { createSubscriptionBackend } from '@keycard/subscription-backend';

const backend = await createSubscriptionBackend({
  port: 4000,
  database: {
    url: process.env.DATABASE_URL,
  },
  payment: {
    provider: 'dodo_payments',
    config: {
      apiKey: process.env.DODO_API_KEY!,
      apiSecret: process.env.DODO_API_SECRET!,
      merchantId: process.env.DODO_MERCHANT_ID!,
    },
  },
  auth: {
    validateRequest: async (req) => {
      // Replace with your auth logic
      const token = req.headers.authorization?.replace('Bearer ', '');
      const user = await yourAuthService.verify(token);
      return {
        userId: user.id,
        tenantId: user.organizationId,
        isValid: true,
      };
    },
  },
});

console.log('Subscription backend running on http://localhost:4000');
```

## Step 4: Run Your Server

```bash
ts-node server.ts
```

## Step 5: Create Your First Plan

```bash
curl -X POST http://localhost:4000/api/v1/plans \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Starter",
    "pricing_model": "flat",
    "amount": 9.99,
    "currency": "USD",
    "billing_interval": "month",
    "trial_period_days": 14,
    "features": {
      "max_users": 3,
      "storage_gb": 5
    }
  }'
```

## Step 6: Subscribe a User

```bash
curl -X POST http://localhost:4000/api/v1/subscriptions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_123",
    "plan_id": "plan_abc123"
  }'
```

## That's It!

You now have a fully functional subscription backend running. Check out the [README](README.md) for more advanced features and configuration options.

## Next Steps

- Set up [webhooks](README.md#webhooks) to receive events
- Configure [lifecycle hooks](README.md#lifecycle-hooks) for custom logic
- Explore [analytics endpoints](README.md#analytics)
- Integrate with your frontend

## Common Issues

### Database Connection Failed

Make sure your PostgreSQL server is running and the `DATABASE_URL` is correct.

### Authentication Errors

Ensure your `validateRequest` function properly verifies tokens and returns the required fields (`userId`, `tenantId`, `isValid`).

### Port Already in Use

Change the port in your configuration or stop the process using that port.

## Need Help?

- Check the [README](README.md) for detailed documentation
- Review the [examples](examples/) folder
- Open an issue on GitHub
