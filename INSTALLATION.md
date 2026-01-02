# Installation Guide

## Step-by-Step Installation

### 1. Install Dependencies

```bash
cd keycard
npm install
```

### 2. Set Up PostgreSQL Database

Create a new PostgreSQL database:

```sql
CREATE DATABASE subscriptions;
CREATE USER subscription_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE subscriptions TO subscription_user;
```

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
DATABASE_URL=postgresql://subscription_user:your_secure_password@localhost:5432/subscriptions
DODO_API_KEY=your_dodo_api_key
DODO_API_SECRET=your_dodo_api_secret
DODO_MERCHANT_ID=your_merchant_id
WEBHOOK_SECRET=generate_a_random_secret_here
PORT=4000
LOG_LEVEL=info
```

### 4. Generate Prisma Client

```bash
npm run prisma:generate
```

### 5. Run Database Migrations

```bash
npm run prisma:migrate
```

This will create all necessary tables in your database.

### 6. Build the Package

```bash
npm run build
```

### 7. Run Tests (Optional)

```bash
npm test
```

For coverage report:

```bash
npm run test:coverage
```

## Development Setup

For development with hot reload:

```bash
npm run dev
```

## Production Build

1. Build the package:

```bash
npm run build
```

2. The compiled JavaScript will be in the `dist/` folder

3. To publish to npm (if you want to use it across multiple projects):

```bash
npm publish
```

## Using the Package in Another Project

### Installation

```bash
npm install @keycard/subscription-backend
```

### Import and Use

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
      apiKey: process.env.DODO_API_KEY,
      apiSecret: process.env.DODO_API_SECRET,
      merchantId: process.env.DODO_MERCHANT_ID,
    },
  },
  auth: {
    validateRequest: async (req) => {
      // Your auth logic here
    },
  },
});
```

## Database Management

### View Database in Prisma Studio

```bash
npm run prisma:studio
```

This opens a GUI at http://localhost:5555 to view and edit your data.

### Create a New Migration

After changing the Prisma schema:

```bash
npx prisma migrate dev --name describe_your_changes
```

### Reset Database (Development Only)

```bash
npx prisma migrate reset
```

**Warning**: This will delete all data!

## Troubleshooting

### Port Already in Use

If port 4000 is already in use, change it in your configuration:

```typescript
{
  port: 5000, // Use different port
  // ...
}
```

### Database Connection Failed

1. Ensure PostgreSQL is running:

```bash
# On macOS
brew services start postgresql

# On Linux
sudo systemctl start postgresql
```

2. Check your DATABASE_URL is correct
3. Verify user permissions in PostgreSQL

### Prisma Client Not Found

Run:

```bash
npm run prisma:generate
```

### TypeScript Errors

Ensure you have the correct TypeScript version:

```bash
npm install --save-dev typescript@^5.3.3
```

### Test Failures

Make sure you're using Node.js >= 18:

```bash
node --version
```

## Docker Setup (Optional)

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: subscriptions
      POSTGRES_USER: subscription_user
      POSTGRES_PASSWORD: your_secure_password
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  app:
    build: .
    ports:
      - '4000:4000'
    environment:
      DATABASE_URL: postgresql://subscription_user:your_secure_password@postgres:5432/subscriptions
    depends_on:
      - postgres

volumes:
  postgres_data:
```

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build
RUN npx prisma generate

EXPOSE 4000

CMD ["node", "dist/index.js"]
```

Run with Docker:

```bash
docker-compose up
```

## Verification

After installation, verify everything is working:

1. Start the server
2. Check health endpoint:

```bash
curl http://localhost:4000/api/v1/health
```

Expected response:

```json
{
  "status": "healthy",
  "database": "connected",
  "payment_provider": "operational",
  "uptime": 123
}
```

## Next Steps

- Read the [Quick Start Guide](QUICK_START.md)
- Check out the [README](README.md) for usage examples
- Review the [examples/](examples/) folder

## Support

If you encounter issues:

1. Check the [troubleshooting section](#troubleshooting)
2. Review closed issues on GitHub
3. Open a new issue with:
   - Error message
   - Steps to reproduce
   - Environment details (OS, Node version, etc.)
