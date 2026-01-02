# Subscription API Backend NPM Package - Specification

## Overview
A plug-and-play NPM package that provides a complete subscription management backend for SaaS applications. Import the package, configure it with minimal settings (DB credentials, subscription plans, port), and get a fully functional subscription API running on a separate port.

## Technology Stack
- **Database**: PostgreSQL with single shared database (tenant_id based multi-tenancy)
- **Payment Provider**: DoDo Payments (custom integration)
- **Authentication**: Bring-your-own-auth (package accepts user_id/tenant_id from your app)
- **Framework**: Express.js (separate instance on configurable port)
- **ORM**: Prisma (auto-migration support, type-safe queries)
- **Language**: TypeScript (full type safety for consumers)

---

## 1. Functional Specification

### 1.1 Core Features

#### Subscription Management
- Create, read, update, delete subscription plans
- Subscribe users to plans
- Upgrade/downgrade subscriptions
- Cancel subscriptions (immediate or end-of-period)
- Pause/resume subscriptions
- Track subscription status (active, canceled, past_due, trialing, paused)
- Usage-based billing support (track usage metrics)
- Proration handling for plan changes

#### Plan Management
- Multiple pricing models:
  - Flat rate (monthly/yearly)
  - Tiered pricing (usage tiers)
  - Per-seat pricing
  - Usage-based (metered billing)
- Free trial support (configurable duration)
- Setup fees
- Multiple billing intervals (daily, weekly, monthly, yearly, custom)
- Plan features/limits (storage, API calls, users, etc.)

#### Billing & Invoicing
- Auto-generate invoices on billing cycle
- Invoice history and retrieval
- Payment status tracking
- Failed payment retry logic (configurable retry schedule)
- Dunning management (email notifications for failed payments)
- Pro-rated billing calculations
- Tax calculation support (configurable tax rates)

#### Multi-Tenancy
- Tenant isolation via `tenant_id` column
- Tenant-specific plan configurations
- Tenant-level analytics and reporting
- Cross-tenant data protection (automatic query filtering)

#### Webhooks
- Subscription lifecycle events (created, updated, canceled, renewed)
- Payment events (succeeded, failed, refunded)
- Invoice events (generated, paid, payment_failed)
- Configurable webhook endpoints per tenant
- Webhook signature verification
- Automatic retry for failed webhooks

#### Analytics & Reporting
- MRR (Monthly Recurring Revenue) calculation
- ARR (Annual Recurring Revenue)
- Churn rate tracking
- Subscription growth metrics
- Customer lifetime value (LTV)
- Revenue by plan/tenant
- Failed payment analytics

### 1.2 Database Schema

#### Tables
1. **tenants**
   - id (uuid, primary key)
   - name (string)
   - api_key (encrypted string, for authentication)
   - webhook_url (string, nullable)
   - webhook_secret (encrypted string)
   - settings (jsonb - custom configurations)
   - created_at, updated_at

2. **subscription_plans**
   - id (uuid, primary key)
   - tenant_id (uuid, foreign key)
   - name (string)
   - description (text, nullable)
   - pricing_model (enum: flat, tiered, per_seat, usage_based)
   - amount (decimal)
   - currency (string, default: USD)
   - billing_interval (enum: day, week, month, year)
   - billing_interval_count (int, default: 1)
   - trial_period_days (int, nullable)
   - setup_fee (decimal, nullable)
   - features (jsonb - feature flags and limits)
   - is_active (boolean, default: true)
   - created_at, updated_at

3. **subscriptions**
   - id (uuid, primary key)
   - tenant_id (uuid, foreign key)
   - user_id (string - from your app's auth system)
   - plan_id (uuid, foreign key)
   - status (enum: trialing, active, past_due, canceled, paused, expired)
   - current_period_start (timestamp)
   - current_period_end (timestamp)
   - trial_start (timestamp, nullable)
   - trial_end (timestamp, nullable)
   - canceled_at (timestamp, nullable)
   - ended_at (timestamp, nullable)
   - quantity (int, default: 1 - for per-seat pricing)
   - metadata (jsonb - custom data)
   - created_at, updated_at

4. **invoices**
   - id (uuid, primary key)
   - tenant_id (uuid, foreign key)
   - subscription_id (uuid, foreign key)
   - user_id (string)
   - invoice_number (string, unique)
   - amount_due (decimal)
   - amount_paid (decimal, default: 0)
   - currency (string)
   - status (enum: draft, open, paid, void, uncollectible)
   - tax_amount (decimal, default: 0)
   - subtotal (decimal)
   - total (decimal)
   - due_date (timestamp)
   - paid_at (timestamp, nullable)
   - period_start (timestamp)
   - period_end (timestamp)
   - metadata (jsonb)
   - created_at, updated_at

5. **invoice_items**
   - id (uuid, primary key)
   - invoice_id (uuid, foreign key)
   - description (string)
   - quantity (int)
   - unit_amount (decimal)
   - amount (decimal)
   - proration (boolean, default: false)
   - metadata (jsonb)

6. **payments**
   - id (uuid, primary key)
   - tenant_id (uuid, foreign key)
   - invoice_id (uuid, foreign key, nullable)
   - user_id (string)
   - amount (decimal)
   - currency (string)
   - status (enum: pending, succeeded, failed, refunded)
   - payment_provider (string - 'dodo_payments')
   - provider_payment_id (string - external payment ID)
   - payment_method_details (jsonb)
   - failure_reason (text, nullable)
   - refunded_amount (decimal, default: 0)
   - metadata (jsonb)
   - created_at, updated_at

7. **usage_records**
   - id (uuid, primary key)
   - tenant_id (uuid, foreign key)
   - subscription_id (uuid, foreign key)
   - user_id (string)
   - metric_name (string - e.g., 'api_calls', 'storage_gb')
   - quantity (decimal)
   - timestamp (timestamp)
   - metadata (jsonb)

8. **webhook_events**
   - id (uuid, primary key)
   - tenant_id (uuid, foreign key)
   - event_type (string)
   - payload (jsonb)
   - delivery_attempts (int, default: 0)
   - last_attempt_at (timestamp, nullable)
   - delivered_at (timestamp, nullable)
   - status (enum: pending, delivered, failed)
   - error_message (text, nullable)
   - created_at

---

## 2. API Specification

### 2.1 Package Installation & Configuration

#### Installation
```bash
npm install @yourname/subscription-backend
```

#### Basic Setup (in your main application)
```typescript
import { createSubscriptionBackend } from '@yourname/subscription-backend';
import express from 'express';

const mainApp = express();

// Your main application routes
mainApp.get('/', (req, res) => res.send('Main app'));

// Initialize subscription backend
const subscriptionServer = await createSubscriptionBackend({
  port: 4000, // Separate port for subscription API
  database: {
    host: 'localhost',
    port: 5432,
    database: 'myapp_subscriptions',
    username: 'postgres',
    password: 'password',
    ssl: false,
    // Optional: provide existing Prisma client
    // prismaClient: myPrismaClient
  },
  payment: {
    provider: 'dodo_payments',
    config: {
      apiKey: process.env.DODO_API_KEY,
      apiSecret: process.env.DODO_API_SECRET,
      webhookSecret: process.env.DODO_WEBHOOK_SECRET,
      // Provider-specific settings
      merchantId: process.env.DODO_MERCHANT_ID,
    }
  },
  auth: {
    // Since you're bringing your own auth, provide a validator
    validateRequest: async (req) => {
      // Your custom logic to extract user_id and tenant_id from request
      const token = req.headers.authorization?.replace('Bearer ', '');
      const decoded = await yourAuthService.verifyToken(token);
      return {
        userId: decoded.userId,
        tenantId: decoded.tenantId,
        isValid: true
      };
    }
  },
  features: {
    autoMigration: true, // Auto-run Prisma migrations on startup
    webhooks: true,
    analytics: true,
    dunning: {
      enabled: true,
      retrySchedule: [1, 3, 5, 7], // Days to retry failed payments
      emailProvider: 'sendgrid', // or 'ses', 'custom'
      emailConfig: {
        apiKey: process.env.SENDGRID_API_KEY,
        fromEmail: 'billing@yoursaas.com'
      }
    }
  },
  // Optional: custom logger
  logger: console, // or winston/pino instance
});

// Start both servers
mainApp.listen(3000, () => console.log('Main app on 3000'));
// Subscription backend starts automatically on port 4000
```

#### Advanced Configuration
```typescript
const subscriptionServer = await createSubscriptionBackend({
  port: 4000,
  database: {
    url: process.env.DATABASE_URL, // Or use connection string
    poolSize: 10,
    timeout: 30000,
  },
  payment: {
    provider: 'dodo_payments',
    config: { /* ... */ },
    // Optional: custom payment processor
    customProcessor: {
      createPayment: async (amount, currency, metadata) => {
        // Your custom integration logic
        return { paymentId: '...', status: 'succeeded' };
      },
      refundPayment: async (paymentId, amount) => { /* ... */ },
      // ... other required methods
    }
  },
  // Lifecycle hooks
  hooks: {
    onSubscriptionCreated: async (subscription) => {
      // Custom logic after subscription creation
      await yourAnalytics.track('subscription_created', subscription);
    },
    onPaymentFailed: async (payment, subscription) => {
      // Custom failed payment handling
      await yourNotificationService.send(subscription.userId, 'payment_failed');
    },
    onSubscriptionCanceled: async (subscription) => { /* ... */ },
    onInvoiceGenerated: async (invoice) => { /* ... */ },
  },
  // CORS configuration
  cors: {
    origin: ['https://yoursaas.com', 'https://app.yoursaas.com'],
    credentials: true
  },
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // Limit each IP to 100 requests per window
  }
});

// Access the Express app instance for custom routes
subscriptionServer.app.post('/custom-endpoint', (req, res) => {
  // Your custom logic
});

// Programmatic control
await subscriptionServer.start(); // Start the server
await subscriptionServer.stop(); // Stop the server
await subscriptionServer.restart(); // Restart
```

---

### 2.2 REST API Endpoints

**Base URL**: `http://localhost:4000/api/v1`

**Authentication**: All requests require authentication header:
```
Authorization: Bearer <your-jwt-token>
```
The package validates this using your `validateRequest` function and extracts `userId` and `tenantId`.

---

#### **Subscription Plans**

##### `POST /plans`
Create a new subscription plan.

**Request:**
```json
{
  "name": "Pro Plan",
  "description": "For growing teams",
  "pricing_model": "flat",
  "amount": 49.99,
  "currency": "USD",
  "billing_interval": "month",
  "billing_interval_count": 1,
  "trial_period_days": 14,
  "setup_fee": 99.00,
  "features": {
    "max_users": 10,
    "max_storage_gb": 100,
    "api_calls_per_month": 100000,
    "priority_support": true
  }
}
```

**Response:** `201 Created`
```json
{
  "id": "plan_abc123",
  "tenant_id": "tenant_xyz",
  "name": "Pro Plan",
  "pricing_model": "flat",
  "amount": 49.99,
  "currency": "USD",
  "billing_interval": "month",
  "billing_interval_count": 1,
  "trial_period_days": 14,
  "setup_fee": 99.00,
  "features": { /* ... */ },
  "is_active": true,
  "created_at": "2025-01-02T10:00:00Z",
  "updated_at": "2025-01-02T10:00:00Z"
}
```

##### `GET /plans`
List all plans for the tenant.

**Query Parameters:**
- `is_active` (boolean, optional): Filter by active status
- `pricing_model` (string, optional): Filter by pricing model
- `page` (int, default: 1)
- `limit` (int, default: 20)

**Response:** `200 OK`
```json
{
  "data": [
    { /* plan object */ },
    { /* plan object */ }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "total_pages": 1
  }
}
```

##### `GET /plans/:planId`
Get a specific plan by ID.

**Response:** `200 OK` - Plan object

##### `PATCH /plans/:planId`
Update a plan.

**Request:**
```json
{
  "name": "Pro Plan Updated",
  "amount": 59.99,
  "is_active": false
}
```

**Response:** `200 OK` - Updated plan object

##### `DELETE /plans/:planId`
Soft delete a plan (sets `is_active` to false).

**Response:** `204 No Content`

---

#### **Subscriptions**

##### `POST /subscriptions`
Create a new subscription for a user.

**Request:**
```json
{
  "user_id": "user_123", // Optional if extracted from auth
  "plan_id": "plan_abc123",
  "quantity": 1,
  "trial_period_days": 14, // Optional, overrides plan default
  "metadata": {
    "source": "website",
    "campaign": "summer_sale"
  }
}
```

**Response:** `201 Created`
```json
{
  "id": "sub_xyz789",
  "tenant_id": "tenant_xyz",
  "user_id": "user_123",
  "plan_id": "plan_abc123",
  "status": "trialing",
  "current_period_start": "2025-01-02T10:00:00Z",
  "current_period_end": "2025-02-02T10:00:00Z",
  "trial_start": "2025-01-02T10:00:00Z",
  "trial_end": "2025-01-16T10:00:00Z",
  "quantity": 1,
  "metadata": { /* ... */ },
  "created_at": "2025-01-02T10:00:00Z"
}
```

##### `GET /subscriptions`
List subscriptions.

**Query Parameters:**
- `user_id` (string, optional): Filter by user
- `status` (string, optional): Filter by status
- `plan_id` (string, optional): Filter by plan
- `page`, `limit`

**Response:** `200 OK` - Paginated list of subscriptions

##### `GET /subscriptions/:subscriptionId`
Get a specific subscription.

**Response:** `200 OK` - Subscription object with nested plan details

##### `PATCH /subscriptions/:subscriptionId`
Update a subscription (e.g., change plan, quantity).

**Request:**
```json
{
  "plan_id": "plan_new456", // Upgrade/downgrade
  "quantity": 5, // Change seats
  "proration_behavior": "create_prorations" // or "none", "always_invoice"
}
```

**Response:** `200 OK` - Updated subscription with proration details

##### `POST /subscriptions/:subscriptionId/cancel`
Cancel a subscription.

**Request:**
```json
{
  "cancel_at_period_end": true, // false for immediate cancellation
  "reason": "Customer request"
}
```

**Response:** `200 OK`
```json
{
  "id": "sub_xyz789",
  "status": "active", // Still active until period end
  "canceled_at": "2025-01-02T10:00:00Z",
  "cancel_at_period_end": true,
  "current_period_end": "2025-02-02T10:00:00Z"
}
```

##### `POST /subscriptions/:subscriptionId/pause`
Pause a subscription.

**Request:**
```json
{
  "resume_at": "2025-03-01T00:00:00Z" // Optional auto-resume date
}
```

**Response:** `200 OK` - Subscription with status "paused"

##### `POST /subscriptions/:subscriptionId/resume`
Resume a paused subscription.

**Response:** `200 OK` - Subscription with status "active"

---

#### **Invoices**

##### `GET /invoices`
List invoices.

**Query Parameters:**
- `user_id` (string, optional)
- `subscription_id` (string, optional)
- `status` (string, optional)
- `page`, `limit`

**Response:** `200 OK` - Paginated list of invoices

##### `GET /invoices/:invoiceId`
Get invoice details with line items.

**Response:** `200 OK`
```json
{
  "id": "inv_abc123",
  "invoice_number": "INV-2025-001",
  "subscription_id": "sub_xyz789",
  "user_id": "user_123",
  "amount_due": 49.99,
  "amount_paid": 49.99,
  "currency": "USD",
  "status": "paid",
  "tax_amount": 4.50,
  "subtotal": 45.49,
  "total": 49.99,
  "due_date": "2025-02-02T00:00:00Z",
  "paid_at": "2025-02-01T15:30:00Z",
  "period_start": "2025-01-02T00:00:00Z",
  "period_end": "2025-02-02T00:00:00Z",
  "line_items": [
    {
      "description": "Pro Plan (Jan 02 - Feb 02)",
      "quantity": 1,
      "unit_amount": 45.49,
      "amount": 45.49,
      "proration": false
    }
  ],
  "created_at": "2025-01-25T00:00:00Z"
}
```

##### `POST /invoices/:invoiceId/pay`
Manually trigger payment for an invoice.

**Request:**
```json
{
  "payment_method": "card",
  "metadata": {}
}
```

**Response:** `200 OK` - Payment result with updated invoice

---

#### **Payments**

##### `GET /payments`
List payments.

**Query Parameters:**
- `user_id`, `invoice_id`, `status`, `page`, `limit`

**Response:** `200 OK` - Paginated list of payments

##### `GET /payments/:paymentId`
Get payment details.

**Response:** `200 OK` - Payment object

##### `POST /payments/:paymentId/refund`
Refund a payment.

**Request:**
```json
{
  "amount": 49.99, // Optional, defaults to full refund
  "reason": "Customer request"
}
```

**Response:** `200 OK` - Payment with updated refund details

---

#### **Usage Tracking** (for usage-based billing)

##### `POST /usage`
Record usage for a subscription.

**Request:**
```json
{
  "subscription_id": "sub_xyz789",
  "metric_name": "api_calls",
  "quantity": 150,
  "timestamp": "2025-01-02T10:30:00Z", // Optional, defaults to now
  "metadata": {
    "endpoint": "/api/data",
    "method": "GET"
  }
}
```

**Response:** `201 Created`
```json
{
  "id": "usage_123",
  "subscription_id": "sub_xyz789",
  "metric_name": "api_calls",
  "quantity": 150,
  "timestamp": "2025-01-02T10:30:00Z"
}
```

##### `GET /usage`
Retrieve usage records.

**Query Parameters:**
- `subscription_id` (required)
- `metric_name` (optional)
- `start_date`, `end_date` (optional, ISO 8601 format)
- `page`, `limit`

**Response:** `200 OK`
```json
{
  "data": [
    { /* usage record */ }
  ],
  "summary": {
    "total_quantity": 15750,
    "metric_name": "api_calls",
    "period_start": "2025-01-01T00:00:00Z",
    "period_end": "2025-02-01T00:00:00Z"
  },
  "pagination": { /* ... */ }
}
```

---

#### **Analytics**

##### `GET /analytics/mrr`
Get Monthly Recurring Revenue.

**Query Parameters:**
- `start_date`, `end_date` (optional)
- `group_by` (optional: `plan`, `tenant`)

**Response:** `200 OK`
```json
{
  "current_mrr": 12500.00,
  "previous_mrr": 11200.00,
  "growth_rate": 11.61,
  "currency": "USD",
  "breakdown": [
    {
      "plan_id": "plan_abc123",
      "plan_name": "Pro Plan",
      "mrr": 5000.00,
      "subscriber_count": 100
    }
  ]
}
```

##### `GET /analytics/churn`
Get churn rate metrics.

**Query Parameters:**
- `period` (optional: `month`, `quarter`, `year`)

**Response:** `200 OK`
```json
{
  "churn_rate": 5.2,
  "churned_customers": 13,
  "total_customers": 250,
  "period_start": "2025-01-01T00:00:00Z",
  "period_end": "2025-02-01T00:00:00Z"
}
```

##### `GET /analytics/revenue`
Revenue breakdown.

**Query Parameters:**
- `start_date`, `end_date`, `group_by` (day, week, month)

**Response:** `200 OK`
```json
{
  "total_revenue": 45000.00,
  "currency": "USD",
  "timeline": [
    {
      "date": "2025-01-01",
      "revenue": 1500.00
    },
    {
      "date": "2025-01-02",
      "revenue": 1750.00
    }
  ]
}
```

---

#### **Webhooks** (DoDo Payments)

##### `POST /webhooks/dodo` (Internal endpoint)
Receives webhooks from DoDo Payments. This endpoint is automatically configured and secured with signature verification.

**Internal handling:**
- Verifies webhook signature
- Processes payment events (succeeded, failed)
- Updates invoice/payment status
- Triggers lifecycle hooks
- Sends webhooks to tenant endpoints

---

#### **Admin/Management**

##### `POST /tenants` (Optional, if you want package to manage tenants)
Create a new tenant.

**Request:**
```json
{
  "name": "Acme Corp",
  "webhook_url": "https://acme.com/subscription-webhooks",
  "settings": {
    "tax_rate": 0.09,
    "default_currency": "USD"
  }
}
```

**Response:** `201 Created`
```json
{
  "id": "tenant_xyz",
  "name": "Acme Corp",
  "api_key": "sk_live_abc123...", // Encrypted, for authentication
  "webhook_url": "https://acme.com/subscription-webhooks",
  "webhook_secret": "whsec_xyz789..." // For signature verification
}
```

##### `GET /health`
Health check endpoint.

**Response:** `200 OK`
```json
{
  "status": "healthy",
  "database": "connected",
  "payment_provider": "operational",
  "uptime": 3600
}
```

---

### 2.3 Webhook Events (Sent to Tenant URLs)

When important events occur, the package sends webhooks to the `webhook_url` configured for each tenant.

**Webhook Format:**
```json
{
  "id": "evt_abc123",
  "event_type": "subscription.created",
  "tenant_id": "tenant_xyz",
  "created_at": "2025-01-02T10:00:00Z",
  "data": {
    /* Event-specific payload */
  }
}
```

**Event Types:**
- `subscription.created`
- `subscription.updated`
- `subscription.canceled`
- `subscription.paused`
- `subscription.resumed`
- `subscription.trial_ending` (3 days before trial ends)
- `invoice.created`
- `invoice.paid`
- `invoice.payment_failed`
- `payment.succeeded`
- `payment.failed`
- `payment.refunded`

**Signature Verification:**
Each webhook includes a `X-Subscription-Signature` header that your app should verify using the `webhook_secret`:

```typescript
import crypto from 'crypto';

function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

---

### 2.4 Programmatic API (Alternative to REST)

Instead of making HTTP requests, you can also use the package programmatically within your Node.js app:

```typescript
import { createSubscriptionBackend } from '@yourname/subscription-backend';

const backend = await createSubscriptionBackend({ /* config */ });

// Access the service layer directly
const planService = backend.services.plans;
const subscriptionService = backend.services.subscriptions;

// Create a plan
const plan = await planService.create({
  tenantId: 'tenant_xyz',
  name: 'Enterprise',
  amount: 199.99,
  // ... other fields
});

// Subscribe a user
const subscription = await subscriptionService.create({
  tenantId: 'tenant_xyz',
  userId: 'user_456',
  planId: plan.id,
  quantity: 5
});

// Check subscription status
const isActive = await subscriptionService.isActive('sub_xyz789');

// Record usage
await backend.services.usage.record({
  subscriptionId: 'sub_xyz789',
  metricName: 'api_calls',
  quantity: 100
});

// Get analytics
const mrr = await backend.services.analytics.getMRR({
  tenantId: 'tenant_xyz'
});
```

---

### 2.5 Error Handling

All endpoints follow consistent error response format:

**Error Response:**
```json
{
  "error": {
    "code": "resource_not_found",
    "message": "Subscription not found",
    "details": {
      "subscription_id": "sub_invalid"
    },
    "request_id": "req_abc123"
  }
}
```

**Error Codes:**
- `authentication_failed` (401)
- `authorization_failed` (403)
- `resource_not_found` (404)
- `validation_error` (400)
- `payment_failed` (402)
- `rate_limit_exceeded` (429)
- `internal_server_error` (500)
- `service_unavailable` (503)

---

## 3. DoDo Payments Integration

Since you specified "DoDo Payments" (which appears to be a custom/regional payment provider), the package will need a payment adapter interface:

### Payment Adapter Interface

```typescript
interface PaymentAdapter {
  name: string;

  // Create a payment
  createPayment(params: {
    amount: number;
    currency: string;
    customerId: string;
    metadata?: Record<string, any>;
  }): Promise<{
    paymentId: string;
    status: 'pending' | 'succeeded' | 'failed';
    providerResponse: any;
  }>;

  // Refund a payment
  refundPayment(params: {
    paymentId: string;
    amount?: number; // Optional partial refund
    reason?: string;
  }): Promise<{
    refundId: string;
    status: 'succeeded' | 'failed';
  }>;

  // Verify webhook signature
  verifyWebhook(params: {
    payload: string;
    signature: string;
    secret: string;
  }): boolean;

  // Handle webhook event
  processWebhook(payload: any): Promise<{
    eventType: string;
    paymentId: string;
    status: string;
    metadata: any;
  }>;
}
```

### DoDo Payments Adapter Implementation

You'll need to provide DoDo Payments-specific implementation:

```typescript
class DodoPaymentsAdapter implements PaymentAdapter {
  name = 'dodo_payments';
  private apiKey: string;
  private apiSecret: string;

  constructor(config: { apiKey: string; apiSecret: string; merchantId: string }) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    // Initialize DoDo SDK
  }

  async createPayment(params) {
    // Call DoDo Payments API
    const response = await dodoPaymentsSDK.createCharge({
      amount: params.amount,
      currency: params.currency,
      customer: params.customerId,
      metadata: params.metadata
    });

    return {
      paymentId: response.id,
      status: this.mapStatus(response.status),
      providerResponse: response
    };
  }

  async refundPayment(params) {
    // DoDo refund logic
  }

  verifyWebhook(params) {
    // DoDo signature verification
    return dodoPaymentsSDK.verifySignature(
      params.payload,
      params.signature,
      params.secret
    );
  }

  async processWebhook(payload) {
    // Parse DoDo webhook format and normalize
    return {
      eventType: payload.event_type,
      paymentId: payload.data.charge_id,
      status: this.mapStatus(payload.data.status),
      metadata: payload.data
    };
  }

  private mapStatus(dodoStatus: string): string {
    // Map DoDo-specific statuses to standard ones
    const statusMap = {
      'success': 'succeeded',
      'failure': 'failed',
      'processing': 'pending'
    };
    return statusMap[dodoStatus] || 'pending';
  }
}
```

---

## 4. Key Implementation Details

### 4.1 Auto-Migration
When `autoMigration: true`, the package automatically runs Prisma migrations on startup:
- Checks if database exists, creates if not
- Runs pending migrations
- Seeds initial data if needed

### 4.2 Multi-Tenancy Security
Every database query automatically filters by `tenant_id`:
```typescript
// Prisma middleware to inject tenant_id filter
prisma.$use(async (params, next) => {
  if (params.model && TENANT_MODELS.includes(params.model)) {
    if (params.action === 'findUnique' || params.action === 'findMany') {
      params.args.where = {
        ...params.args.where,
        tenant_id: currentTenantId
      };
    }
  }
  return next(params);
});
```

### 4.3 Billing Cycle Management
Background job (using `node-cron` or `bull` queue):
- Runs daily to check subscriptions nearing renewal
- Generates invoices 3 days before billing date
- Attempts payment on billing date
- Handles failed payments with retry logic
- Updates subscription status based on payment result

### 4.4 Proration Logic
When changing plans mid-cycle:
1. Calculate unused time on current plan
2. Calculate credit amount: `(unused_days / total_days) * plan_amount`
3. Calculate prorated charge for new plan
4. Generate invoice with both credit and charge line items
5. Charge the net difference immediately or add to next invoice

---

## 5. Package Structure

```
@yourname/subscription-backend/
├── src/
│   ├── index.ts                 # Main export: createSubscriptionBackend()
│   ├── server.ts                # Express server setup
│   ├── config/
│   │   └── defaults.ts          # Default configuration
│   ├── database/
│   │   ├── prisma/
│   │   │   └── schema.prisma    # Database schema
│   │   └── client.ts            # Prisma client initialization
│   ├── routes/
│   │   ├── plans.ts
│   │   ├── subscriptions.ts
│   │   ├── invoices.ts
│   │   ├── payments.ts
│   │   ├── usage.ts
│   │   ├── analytics.ts
│   │   └── webhooks.ts
│   ├── services/
│   │   ├── planService.ts
│   │   ├── subscriptionService.ts
│   │   ├── invoiceService.ts
│   │   ├── paymentService.ts
│   │   ├── usageService.ts
│   │   ├── analyticsService.ts
│   │   └── webhookService.ts
│   ├── payment-adapters/
│   │   ├── interface.ts         # PaymentAdapter interface
│   │   ├── dodoPayments.ts      # DoDo implementation
│   │   └── index.ts             # Adapter factory
│   ├── jobs/
│   │   ├── billingCycle.ts      # Recurring billing job
│   │   ├── dunning.ts           # Failed payment retry
│   │   └── webhookRetry.ts      # Webhook retry logic
│   ├── middleware/
│   │   ├── auth.ts              # Authentication middleware
│   │   ├── tenantContext.ts     # Tenant isolation
│   │   ├── errorHandler.ts
│   │   └── rateLimiter.ts
│   ├── utils/
│   │   ├── proration.ts
│   │   ├── validators.ts
│   │   └── logger.ts
│   └── types/
│       └── index.ts             # TypeScript type definitions
├── migrations/                   # Prisma migrations
├── tests/
├── package.json
├── tsconfig.json
└── README.md
```

---

## 6. Usage Example (End-to-End)

### Step 1: Install and Configure
```typescript
// server.ts
import express from 'express';
import { createSubscriptionBackend } from '@yourname/subscription-backend';

const app = express();

const subBackend = await createSubscriptionBackend({
  port: 4000,
  database: {
    url: process.env.DATABASE_URL
  },
  payment: {
    provider: 'dodo_payments',
    config: {
      apiKey: process.env.DODO_API_KEY,
      apiSecret: process.env.DODO_SECRET,
      merchantId: process.env.DODO_MERCHANT_ID
    }
  },
  auth: {
    validateRequest: async (req) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const user = await myAuthService.verify(token);
      return {
        userId: user.id,
        tenantId: user.tenantId,
        isValid: !!user
      };
    }
  }
});

app.listen(3000, () => console.log('Main app running on 3000'));
// Subscription API automatically running on 4000
```

### Step 2: Create Plans
```bash
curl -X POST http://localhost:4000/api/v1/plans \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Starter",
    "amount": 19.99,
    "currency": "USD",
    "billing_interval": "month",
    "trial_period_days": 14,
    "features": {
      "max_users": 5,
      "storage_gb": 10
    }
  }'
```

### Step 3: Subscribe a User
```bash
curl -X POST http://localhost:4000/api/v1/subscriptions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_123",
    "plan_id": "plan_abc123"
  }'
```

### Step 4: Check Subscription in Your App
```typescript
// In your main application
app.get('/api/user/features', async (req, res) => {
  const userId = req.user.id;

  // Call subscription backend API
  const subResponse = await fetch(`http://localhost:4000/api/v1/subscriptions?user_id=${userId}`, {
    headers: { 'Authorization': `Bearer ${req.token}` }
  });

  const subscriptions = await subResponse.json();
  const activeSubscription = subscriptions.data.find(s => s.status === 'active');

  if (!activeSubscription) {
    return res.json({ hasAccess: false });
  }

  const planResponse = await fetch(`http://localhost:4000/api/v1/plans/${activeSubscription.plan_id}`, {
    headers: { 'Authorization': `Bearer ${req.token}` }
  });

  const plan = await planResponse.json();

  res.json({
    hasAccess: true,
    features: plan.features,
    subscription: activeSubscription
  });
});
```

### Step 5: Handle Webhooks
```typescript
// In your main app - receive webhooks from subscription backend
app.post('/webhooks/subscription', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-subscription-signature'];
  const payload = req.body.toString();

  // Verify signature
  const isValid = verifyWebhookSignature(payload, signature, process.env.WEBHOOK_SECRET);

  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(payload);

  switch (event.event_type) {
    case 'subscription.canceled':
      // Revoke user access
      await revokeUserAccess(event.data.user_id);
      break;

    case 'invoice.payment_failed':
      // Notify user
      await notifyUser(event.data.user_id, 'payment_failed');
      break;

    // Handle other events...
  }

  res.json({ received: true });
});
```

---

## 7. Additional Considerations

### 7.1 Testing
Package includes test helpers:
```typescript
import { createTestBackend, mockDodoPayments } from '@yourname/subscription-backend/testing';

describe('Subscription flow', () => {
  let backend;

  beforeAll(async () => {
    backend = await createTestBackend({
      database: { url: 'postgresql://localhost/test' },
      payment: mockDodoPayments() // Mock payment provider
    });
  });

  it('should create subscription', async () => {
    const plan = await backend.services.plans.create({ /* ... */ });
    const sub = await backend.services.subscriptions.create({ /* ... */ });
    expect(sub.status).toBe('trialing');
  });
});
```

### 7.2 Monitoring & Logging
- All operations logged with structured logging (JSON format)
- Optional integration with monitoring services (DataDog, NewRelic, Sentry)
- Metrics exported: active subscriptions, MRR, failed payments, webhook delivery rate

### 7.3 Security
- SQL injection protection via Prisma ORM
- Rate limiting on all endpoints
- CORS configuration
- Webhook signature verification
- Encrypted storage for API keys and secrets
- Automatic tenant isolation

### 7.4 Performance
- Database connection pooling
- Caching for frequently accessed plans
- Pagination on all list endpoints
- Background job processing for heavy operations
- Optimized queries with proper indexing

---

## Summary

This specification provides a complete, production-ready subscription management backend as an NPM package. Key highlights:

✅ **Zero-config deployment**: Install, configure, and run on a separate port
✅ **Multi-tenant ready**: Automatic tenant isolation with shared database
✅ **Flexible pricing**: Flat, tiered, per-seat, and usage-based billing
✅ **DoDo Payments integration**: Custom payment adapter pattern
✅ **Comprehensive API**: REST endpoints + programmatic access
✅ **Analytics built-in**: MRR, churn, revenue tracking
✅ **Production features**: Webhooks, dunning, proration, invoicing
✅ **Type-safe**: Full TypeScript support
✅ **Your auth system**: Bring-your-own-auth with custom validators

The package runs as an independent Express server on a configurable port, keeping your subscription logic completely separate from your main application while integrating seamlessly through REST APIs or direct service layer access.
