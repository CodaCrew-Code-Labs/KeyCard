# KeyCard Subscription Backend

A production-ready, plug-and-play NPM package that provides complete subscription management for SaaS applications. Built with TypeScript, Express, PostgreSQL, and Prisma ORM.

## 🚀 Features

- ✅ **Zero-config deployment**: Install, configure, and run on a separate port
- ✅ **Multi-tenant ready**: Automatic tenant isolation with shared database
- ✅ **Payment integration**: DoDo Payments adapter with extensible system
- ✅ **Complete API**: REST endpoints + programmatic access
- ✅ **Session management**: Checkout sessions with automatic cleanup
- ✅ **User management**: User creation, billing status, payment history
- ✅ **Subscription lifecycle**: Active, on-hold, failed, cancelled, expired states
- ✅ **Plan changes**: Upgrades/downgrades with pending change tracking
- ✅ **Production features**: Webhooks, rate limiting, CORS, error handling
- ✅ **Type-safe**: Full TypeScript support with comprehensive types
- ✅ **Bring-your-own-auth**: Integrates with existing authentication systems

## 📦 Installation

```bash
npm install keycard-subscription-backend
```

## 🏃‍♂️ Quick Start

### Option 1: Standalone Server

```typescript
import { createSubscriptionBackend } from 'keycard-subscription-backend';

const backend = await createSubscriptionBackend({
  port: 4000,
  database: {
    url: process.env.DATABASE_URL,
  },
  payment: {
    provider: 'dodo_payments',
    config: {
      apiKey: process.env.DODO_PAYMENTS_API_KEY,
      environment: process.env.DODO_PAYMENTS_ENVIRONMENT,
      webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
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

console.log('Subscription backend running on port 4000');
```

### Option 2: Integrated with Express App

```typescript
import express from 'express';
import { createSubscriptionBackend } from 'keycard-subscription-backend';

const app = express();

// Your existing routes
app.get('/', (req, res) => res.send('Main app'));

// Initialize subscription backend (runs on separate port)
const subscriptionBackend = await createSubscriptionBackend({
  port: 4000,
  // ... configuration
});

// Your app runs on port 3000, subscriptions on port 4000
app.listen(3000, () => console.log('Main app on port 3000'));
```

## ⚙️ Configuration

### Database Setup

1. Create PostgreSQL database:
```sql
CREATE DATABASE subscriptions;
```

2. Set environment variables (all required):
```env
DATABASE_URL=postgresql://user:password@localhost:5432/subscriptions
DODO_PAYMENTS_API_KEY=your_dodo_payments_api_key
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_PAYMENTS_WEBHOOK_KEY=your_webhook_key
CHECKOUT_RETURN_URL=http://localhost:3000
VITE_TEST_TIER_MAPPING='{"default":"free"}'
VITE_PROD_TIER_MAPPING='{"default":"free"}'
```

3. Run migrations:
```bash
npx prisma migrate deploy
```

### Complete Configuration Options

```typescript
const config = {
  port: 4000,
  
  database: {
    url: process.env.DATABASE_URL,
    // OR individual parameters
    host: 'localhost',
    port: 5432,
    database: 'subscriptions',
    username: 'postgres',
    password: 'password',
    ssl: false,
    poolSize: 10,
  },

  payment: {
    provider: 'dodo_payments',
    config: {
      apiKey: process.env.DODO_PAYMENTS_API_KEY,
      environment: process.env.DODO_PAYMENTS_ENVIRONMENT,
      webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
    },
  },

  auth: {
    validateRequest: async (req) => {
      // Your authentication logic
      return {
        userId: 'user_123',
        tenantId: 'tenant_abc',
        isValid: true,
      };
    },
  },

  // Optional features
  features: {
    autoMigration: true,
    webhooks: true,
  },

  cors: {
    origin: ['http://localhost:3000'],
    credentials: true,
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // requests per window
  },

  sessionCleanup: {
    enabled: true,
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
    verbose: false,
  },
};
```

## 🗄️ Database Schema

The system uses 3 main tables:

### UserMapping
- `userUuid` (Primary Key)
- `email` (Unique)
- `dodoCustomerId`
- `subscriptionId` (Active subscription from DoDo)
- `activeTier`, `activeLength`
- `tierExpiresAt`
- `subscriptionStatus` (ACTIVE, ON_HOLD, FAILED, CANCELLED, EXPIRED, GRACE)
- Plan change tracking fields for upgrades/downgrades

### Session
- Checkout session management
- Links to user and payments
- Status tracking (PENDING, COMPLETED, FAILED, EXPIRED)
- Automatic cleanup of expired sessions

### Payment
- Payment records from DoDo Payments
- Status tracking with comprehensive states
- Links to users and sessions
- Raw JSON storage for webhook data

## 🔌 API Endpoints

All endpoints available at `http://localhost:4000/api/v1`

### User Management

#### Create/Get User
```bash
POST /user
{
  "email": "user@example.com"
}
```

#### Get User Billing Status
```bash
GET /user/:email/billing
```

Response:
```json
{
  "activeTier": "PRO",
  "activeLength": "MONTHLY",
  "tierExpiresAt": "2024-02-01T00:00:00.000Z",
  "subscriptionStatus": "ACTIVE",
  "pendingChange": {
    "tier": "BASIC",
    "activeLength": "MONTHLY",
    "effectiveDate": "2024-02-01T00:00:00.000Z",
    "changeType": "downgrade"
  },
  "latestPayment": {
    "status": "COMPLETED",
    "paidAt": "2024-01-01T12:00:00.000Z",
    "amountCents": 2999,
    "currency": "USD",
    "tier": "PRO"
  }
}
```

#### Get Payment History
```bash
GET /user/:email/payments?limit=10&offset=0
```

#### Get Session History
```bash
GET /user/:email/sessions?limit=10&offset=0
```

### DoDo Payments Integration

#### Create Checkout Session
```bash
POST /dodopayments/checkout
{
  "email": "user@example.com",
  "product_id": "prod_123",
  "quantity": 1,
  "return_url": "https://yourapp.com/success"
}
```

#### Handle Webhooks
```bash
POST /dodopayments/webhook
# Automatically processes DoDo Payments webhooks
```

### Admin Operations

#### List All Users
```bash
GET /users
```

#### Get User by Email
```bash
GET /user/:email
```

### Health Check
```bash
GET /health
```

## 🔄 Subscription Lifecycle

### User Journey

1. **User Creation**: POST `/user` creates user with FREE tier
2. **Checkout**: POST `/dodopayments/checkout` creates payment session
3. **Payment**: User completes payment on DoDo Payments
4. **Webhook**: System receives webhook and updates user tier
5. **Billing Check**: GET `/user/:email/billing` returns current status

### Subscription States

- **ACTIVE**: Subscription is active and paid
- **ON_HOLD**: Payment failed, user has grace period
- **FAILED**: Payment failed permanently
- **CANCELLED**: User cancelled subscription
- **EXPIRED**: Subscription expired
- **GRACE**: In grace period after payment failure

### Plan Changes

The system supports plan upgrades/downgrades with pending change tracking:

- Immediate upgrades (take effect immediately)
- Scheduled downgrades (take effect at next billing cycle)
- Frequency changes (monthly ↔ yearly)

## 🎣 Webhooks

### Supported Events

The system processes these DoDo Payments webhook events:

- `payment.completed` - Payment successful
- `payment.failed` - Payment failed
- `subscription.created` - New subscription
- `subscription.updated` - Subscription modified
- `subscription.cancelled` - Subscription cancelled
- `subscription.expired` - Subscription expired

### Webhook Processing

```typescript
// Automatic webhook signature verification
// Updates user tier and subscription status
// Handles payment state transitions
// Manages subscription lifecycle
```

## 🛠️ Development

### Setup

```bash
git clone <repository>
cd KeyCard
npm install
cp .env.example .env
# Edit .env with your values
npm run prisma:generate
npm run prisma:migrate
```

### Development Server

```bash
npm run dev
# Server runs on http://localhost:4000
```

### Testing

```bash
npm test                # Run tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

### Database Management

```bash
npm run prisma:studio   # GUI at http://localhost:5555
npm run prisma:migrate  # Run migrations
```

## 📊 Usage Examples

### Complete Integration Example

```typescript
import { createSubscriptionBackend } from 'keycard-subscription-backend';

// 1. Initialize backend
const backend = await createSubscriptionBackend({
  port: 4000,
  database: { url: process.env.DATABASE_URL },
  payment: {
    provider: 'dodo_payments',
    config: {
      apiKey: process.env.DODO_PAYMENTS_API_KEY,
      environment: process.env.DODO_PAYMENTS_ENVIRONMENT,
      webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
    },
  },
  auth: {
    validateRequest: async (req) => {
      // Your auth logic
      return { userId: 'user_123', tenantId: 'tenant_abc', isValid: true };
    },
  },
});

// 2. Create user
const createUser = async (email: string) => {
  const response = await fetch('http://localhost:4000/api/v1/user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return response.json();
};

// 3. Create checkout session
const createCheckout = async (email: string, productId: string) => {
  const response = await fetch('http://localhost:4000/api/v1/dodopayments/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      product_id: productId,
      quantity: 1,
      return_url: 'https://yourapp.com/success',
    }),
  });
  return response.json();
};

// 4. Check billing status
const getBillingStatus = async (email: string) => {
  const response = await fetch(`http://localhost:4000/api/v1/user/${email}/billing`);
  return response.json();
};

// Usage
const user = await createUser('user@example.com');
const checkout = await createCheckout('user@example.com', 'prod_pro_monthly');
// User completes payment...
const billing = await getBillingStatus('user@example.com');
console.log('User tier:', billing.activeTier);
```

### Frontend Integration

```javascript
// React component example
const SubscriptionButton = ({ email, productId }) => {
  const handleSubscribe = async () => {
    try {
      // Create checkout session
      const response = await fetch('/api/v1/dodopayments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          product_id: productId,
          quantity: 1,
          return_url: window.location.origin + '/success',
        }),
      });
      
      const { checkout_url } = await response.json();
      
      // Redirect to DoDo Payments
      window.location.href = checkout_url;
    } catch (error) {
      console.error('Subscription failed:', error);
    }
  };

  return <button onClick={handleSubscribe}>Subscribe Now</button>;
};
```

## 🔒 Security

- **SQL Injection Protection**: Prisma ORM with parameterized queries
- **Webhook Verification**: HMAC SHA256 signature verification
- **Rate Limiting**: Configurable request limits
- **CORS**: Cross-origin request protection
- **Authentication**: Bring-your-own-auth integration
- **Tenant Isolation**: Multi-tenant data separation

## 🚀 Deployment

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npx prisma generate
EXPOSE 4000
CMD ["node", "dist/server.js"]
```

### Environment Variables (All Required)

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/subscriptions

# DoDo Payments
DODO_PAYMENTS_API_KEY=your_dodo_payments_api_key
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_PAYMENTS_WEBHOOK_KEY=your_webhook_key

# Application
CHECKOUT_RETURN_URL=http://localhost:3000

# Tier Mapping (JSON format)
VITE_TEST_TIER_MAPPING='{"default":"free"}'
VITE_PROD_TIER_MAPPING='{"default":"free"}'

# Optional
PORT=4000
NODE_ENV=production
```

### Production Checklist

- [ ] Set up PostgreSQL database
- [ ] Configure environment variables
- [ ] Run database migrations
- [ ] Set up DoDo Payments webhooks
- [ ] Configure authentication
- [ ] Set up monitoring and logging
- [ ] Configure CORS for your domain
- [ ] Set up SSL/TLS

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

### Development Guidelines

- Write tests for new features
- Follow TypeScript best practices
- Update documentation
- Ensure backward compatibility

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: Open an issue on GitHub with detailed reproduction steps
- **Discussions**: Use GitHub Discussions for questions and ideas

## 🗺️ Roadmap

- [ ] Additional payment providers (Stripe, PayPal)
- [ ] Subscription analytics dashboard
- [ ] Email notification templates
- [ ] Customer portal UI components
- [ ] GraphQL API support
- [ ] Advanced dunning management
- [ ] Revenue recognition reports
- [ ] Discount codes and promotions

---

**Built with ❤️ for SaaS developers who want to ship fast**

*KeyCard Subscription Backend - Production-ready subscription management in minutes, not months.*