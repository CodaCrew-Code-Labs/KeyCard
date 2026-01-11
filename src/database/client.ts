import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { DatabaseConfig, Logger } from '../types';

let prismaClient: PrismaClient | null = null;
let pool: pg.Pool | null = null;

/**
 * Initialize Prisma client with configuration
 */
export function initializePrismaClient(config: DatabaseConfig, logger: Logger): PrismaClient {
  if (config.prismaClient) {
    prismaClient = config.prismaClient;
    return prismaClient;
  }

  let databaseUrl: string;

  if (config.url) {
    databaseUrl = config.url;
  } else if (config.host && config.database && config.username) {
    const ssl = config.ssl ? '?sslmode=require' : '';
    databaseUrl = `postgresql://${config.username}:${config.password || ''}@${config.host}:${
      config.port || 5432
    }/${config.database}${ssl}`;
  } else {
    throw new Error(
      'Database configuration must include either "url" or "host", "database", and "username"'
    );
  }

  // Set environment variable for Prisma
  process.env.DATABASE_URL = databaseUrl;

  // Create PostgreSQL connection pool and adapter for Prisma 7
  pool = new pg.Pool({ connectionString: databaseUrl });

  // Set up pg pool-level logging
  pool.on('connect', () => {
    logger.debug('New PostgreSQL client connected to pool');
  });

  pool.on('error', (err: Error) => {
    logger.error('PostgreSQL pool error', { error: err.message });
  });

  pool.on('remove', () => {
    logger.debug('PostgreSQL client removed from pool');
  });

  const adapter = new PrismaPg(pool);
  prismaClient = new PrismaClient({ adapter });

  return prismaClient;
}

/**
 * Get existing Prisma client instance
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    throw new Error('Prisma client not initialized. Call initializePrismaClient first.');
  }
  return prismaClient;
}

/**
 * Disconnect Prisma client
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Test database connection
 */
export async function testDatabaseConnection(logger: Logger): Promise<boolean> {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    logger.info('Database connection successful');
    return true;
  } catch (error) {
    logger.error('Database connection failed', error);
    return false;
  }
}

/**
 * Run migrations if auto-migration is enabled
 */
export async function runMigrations(logger: Logger): Promise<void> {
  try {
    // Note: In production, you should run migrations separately
    // This is a simplified version for development
    logger.info('Checking for pending migrations...');

    // Prisma migrate deploy should be run via CLI in production
    // For this package, we'll rely on users running migrations manually
    logger.info('Migrations should be run manually using: npx prisma migrate deploy');
  } catch (error) {
    logger.error('Migration check failed', error);
    throw error;
  }
}
