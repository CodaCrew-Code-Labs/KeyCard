# Development Guide

## Running the Development Server

The package includes a ready-to-use development server with mock authentication for easy testing.

### Quick Start

1. **Install dependencies**:
```bash
npm install
```

2. **Generate Prisma client**:
```bash
npm run prisma:generate
```

3. **Set up environment variables** (optional, has sensible defaults):
```bash
cp .env.example .env
# Edit .env with your database URL if needed
```

4. **Run migrations**:
```bash
npm run prisma:migrate
```

5. **Start the development server**:
```bash
npm run dev
```

The server will start on **http://localhost:4000** with:
- ✅ Mock authentication (accepts any Bearer token)
- ✅ Full API endpoints
- ✅ Lifecycle hooks with console logging
- ✅ Auto-restart on file changes (if using nodemon)

### What You'll See

```
Starting development server...
Using payment provider: dodo_payments
Database connection successful
Billing cycle job started
✅ Development server is running!
📡 API available at: http://localhost:4000/api/v1
🏥 Health check: http://localhost:4000/api/v1/health

💡 Example requests:
   Create plan: POST /api/v1/plans
   List plans: GET /api/v1/plans
   Create subscription: POST /api/v1/subscriptions

🔑 Use any Bearer token for authentication (mock auth enabled)
   Example: -H "Authorization: Bearer test-token"

Press Ctrl+C to stop the server
```

## Testing the API

### Health Check
```bash
curl http://localhost:4000/api/v1/health
```

### Create a Plan
```bash
curl -X POST http://localhost:4000/api/v1/plans \
  -H "Authorization: Bearer my-test-token" \
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
      "storage_gb": 100
    }
  }'
```

### List Plans
```bash
curl http://localhost:4000/api/v1/plans \
  -H "Authorization: Bearer my-test-token"
```

### Create a Subscription
```bash
curl -X POST http://localhost:4000/api/v1/subscriptions \
  -H "Authorization: Bearer my-test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_123",
    "plan_id": "PLAN_ID_FROM_PREVIOUS_STEP"
  }'
```

### Get Analytics (MRR)
```bash
curl http://localhost:4000/api/v1/analytics/mrr \
  -H "Authorization: Bearer my-test-token"
```

## Development Features

### Mock Authentication

The dev server uses mock authentication that:
- Accepts **any** Bearer token
- Returns a test user: `user_dev_123`
- Returns a test tenant: `tenant_dev_abc`

This allows you to test the API without setting up a real auth system.

### Lifecycle Hooks

The dev server logs all lifecycle events:
- 🎉 Subscription created
- 💰 Payment succeeded
- ❌ Payment failed
- 🚫 Subscription canceled

### Mock Payments

Set `MOCK_PAYMENTS=true` in your `.env` to use mock payment processing that always succeeds (useful for testing).

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Database Management

### View Data in Prisma Studio
```bash
npm run prisma:studio
```
Opens a GUI at http://localhost:5555 to view and edit data.

### Reset Database (Development)
```bash
npx prisma migrate reset
```
**Warning**: This deletes all data!

### Create New Migration
```bash
npm run prisma:migrate
```

## Hot Reload (Optional)

For auto-restart on file changes, use nodemon:

```bash
# Install nodemon globally
npm install -g nodemon

# Run with nodemon
nodemon --exec ts-node src/dev.ts
```

Or add to package.json:
```json
{
  "scripts": {
    "dev:watch": "nodemon --exec ts-node src/dev.ts"
  }
}
```

## Environment Variables

The dev server uses these environment variables (all optional):

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/subscriptions

# Server
PORT=4000
LOG_LEVEL=info

# DoDo Payments (optional in dev mode)
DODO_API_KEY=dev_api_key
DODO_API_SECRET=dev_api_secret
DODO_MERCHANT_ID=dev_merchant_123

# Mock Payments
MOCK_PAYMENTS=true
```

## Production Build

To build for production:

```bash
# Build TypeScript
npm run build

# Run production server
npm start
```

This runs the compiled JavaScript from `dist/dev.js`.

## Debugging

### Enable Debug Logging
```env
LOG_LEVEL=debug
```

### View Database Queries
Prisma queries are logged in debug mode. Check the console for SQL queries.

### Check Background Jobs
The billing cycle job runs daily at midnight. To test manually:
```typescript
// In your code
const billingJob = new BillingCycleJob(prisma, invoiceService, paymentService, logger);
await billingJob.processBillingCycles();
```

## Common Issues

### Port Already in Use
Change the port in `.env`:
```env
PORT=5000
```

### Database Connection Failed
1. Ensure PostgreSQL is running
2. Check `DATABASE_URL` is correct
3. Test connection: `psql -h localhost -U postgres`

### Prisma Client Not Generated
Run:
```bash
npm run prisma:generate
```

### Migration Errors
Reset and re-run:
```bash
npx prisma migrate reset
npm run prisma:migrate
```

## Next Steps

- Read the [API Documentation](README.md#api-endpoints)
- Check out the [examples](examples/) folder
- Review the [test files](src/services/__tests__/) for usage patterns
- Explore the [Prisma schema](prisma/schema.prisma)

## Need Help?

- Open an issue on GitHub
- Check existing issues for solutions
- Review the test files for examples
