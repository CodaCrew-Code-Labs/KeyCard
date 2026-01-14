import express from 'express';
import cors from 'cors';
import { Server } from 'http';
import { SubscriptionBackendConfig, SubscriptionBackend } from './types';
import {
  initializePrismaClient,
  testDatabaseConnection,
  disconnectPrisma,
} from './database/client';
import { createLogger } from './utils/logger';
import { createAuthMiddleware } from './middleware/auth';
import { tenantContextMiddleware } from './middleware/tenantContext';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createRateLimiter } from './middleware/rateLimiter';
import { createRoutes } from './routes';
import { startSessionCleanupJob, stopSessionCleanupJob } from './services/sessionCleanupService';

export async function createSubscriptionBackend(
  config: SubscriptionBackendConfig
): Promise<SubscriptionBackend> {
  const logger = createLogger(config.logger);

  logger.info('Initializing subscription backend');

  // Initialize database
  initializePrismaClient(config.database, logger);

  // Test database connection
  const connected = await testDatabaseConnection(logger);
  if (!connected) {
    throw new Error('Failed to connect to database');
  }

  logger.info('Database connected successfully');

  // Initialize payment service
  if (config.payment?.provider === 'dodo_payments') {
    const { DodoPaymentsService } = await import('./services/dodoPaymentsService');
    DodoPaymentsService.initialize(
      config.payment.config.apiKey,
      config.payment.config.environment || 'test_mode',
      config.payment.config.webhookKey
    );
    logger.info('DodoPayments service initialized');
  }

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
  app.use('/api/v1', createRoutes());

  // Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  if (config.features?.autoMigration) {
    logger.info('Auto-migration enabled');
  }

  if (config.features?.webhooks) {
    logger.info('Webhooks enabled');
  }

  // Start session cleanup job (enabled by default)
  const cleanupEnabled = config.sessionCleanup?.enabled !== false;
  if (cleanupEnabled) {
    startSessionCleanupJob({
      sessionTimeoutMs: config.sessionCleanup?.sessionTimeoutMs,
      cleanupIntervalMs: config.sessionCleanup?.cleanupIntervalMs,
      verbose: config.sessionCleanup?.verbose,
    });
    logger.info('Session cleanup job started');
  }

  // Create backend instance
  let server: Server | null = null;

  const backend: SubscriptionBackend = {
    app,
    server,

    async start() {
      if (server) {
        logger.warn('Server is already running');
        return;
      }

      server = app.listen(config.port, () => {
        logger.info(`Subscription backend listening on port ${config.port}`);
      });

      backend.server = server;
    },

    async stop() {
      if (!server) {
        logger.warn('Server is not running');
        return;
      }

      // Stop cleanup job
      stopSessionCleanupJob();

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
