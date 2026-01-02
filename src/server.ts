import express, { Express } from 'express';
import cors from 'cors';
import { Server } from 'http';
import { PrismaClient } from '@prisma/client';
import { SubscriptionBackendConfig, SubscriptionBackend, Logger } from './types';
import { initializePrismaClient, testDatabaseConnection, disconnectPrisma } from './database/client';
import { createLogger } from './utils/logger';
import { createPaymentAdapter } from './payment-adapters';
import { createAuthMiddleware } from './middleware/auth';
import { tenantContextMiddleware } from './middleware/tenantContext';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createRateLimiter } from './middleware/rateLimiter';
import { PlanService } from './services/planService';
import { SubscriptionService } from './services/subscriptionService';
import { InvoiceService } from './services/invoiceService';
import { PaymentService } from './services/paymentService';
import { UsageService } from './services/usageService';
import { AnalyticsService } from './services/analyticsService';
import { WebhookService } from './services/webhookService';
import { createRoutes } from './routes';
import { BillingCycleJob } from './jobs/billingCycle';

export async function createSubscriptionBackend(
  config: SubscriptionBackendConfig
): Promise<SubscriptionBackend> {
  const logger = createLogger(config.logger);

  logger.info('Initializing subscription backend');

  // Initialize database
  const prisma = initializePrismaClient(config.database, logger);

  // Test database connection
  const connected = await testDatabaseConnection(logger);
  if (!connected) {
    throw new Error('Failed to connect to database');
  }

  // Create payment adapter
  const paymentAdapter = createPaymentAdapter(
    config.payment.provider,
    config.payment.config,
    config.payment.customProcessor
  );

  logger.info(`Using payment provider: ${paymentAdapter.name}`);

  // Initialize services
  const planService = new PlanService(prisma, logger);
  const subscriptionService = new SubscriptionService(prisma, logger, config.hooks);
  const invoiceService = new InvoiceService(prisma, logger, config.hooks);
  const paymentService = new PaymentService(prisma, logger, paymentAdapter, config.hooks);
  const usageService = new UsageService(prisma, logger);
  const analyticsService = new AnalyticsService(prisma, logger);
  const webhookService = new WebhookService(prisma, logger);

  // Create Express app
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS
  if (config.cors) {
    app.use(cors(config.cors));
  }

  // Rate limiting
  if (config.rateLimit) {
    app.use(createRateLimiter(config.rateLimit));
  }

  // Auth middleware
  app.use(createAuthMiddleware(config.auth));

  // Tenant context middleware
  app.use(tenantContextMiddleware());

  // API routes
  app.use('/api/v1', createRoutes(
    planService,
    subscriptionService,
    invoiceService,
    paymentService,
    usageService,
    analyticsService
  ));

  // Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Initialize background jobs
  let billingJob: BillingCycleJob | null = null;

  if (config.features?.autoMigration) {
    logger.info('Auto-migration enabled');
  }

  if (config.features?.webhooks) {
    logger.info('Webhooks enabled');
  }

  // Create backend instance
  let server: Server | null = null;

  const backend: SubscriptionBackend = {
    app,
    server,
    services: {
      plans: planService,
      subscriptions: subscriptionService,
      invoices: invoiceService,
      payments: paymentService,
      usage: usageService,
      analytics: analyticsService,
      webhooks: webhookService,
    },

    async start() {
      if (server) {
        logger.warn('Server is already running');
        return;
      }

      server = app.listen(config.port, () => {
        logger.info(`Subscription backend listening on port ${config.port}`);
      });

      // Start background jobs
      billingJob = new BillingCycleJob(prisma, invoiceService, paymentService, logger);
      billingJob.start();

      backend.server = server;
    },

    async stop() {
      if (!server) {
        logger.warn('Server is not running');
        return;
      }

      // Stop background jobs
      if (billingJob) {
        billingJob.stop();
      }

      // Close server
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Disconnect database
      await disconnectPrisma();

      server = null;
      backend.server = null;

      logger.info('Subscription backend stopped');
    },

    async restart() {
      await this.stop();
      await this.start();
    },
  };

  // Auto-start if not disabled
  if (config.port) {
    await backend.start();
  }

  logger.info('Subscription backend initialized');

  return backend;
}
