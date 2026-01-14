/**
 * Script to manually run session cleanup tasks and verify database connectivity
 *
 * NOTE: This script cannot check if the cron job is running in your server process.
 * The cron job runs inside the server process started by createSubscriptionBackend().
 * To verify the cron job is running, check your server logs for:
 *   "🚀 Starting session cleanup job..."
 *
 * Usage: npx ts-node check-cron-status.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { initializePrismaClient, disconnectPrisma } from './src/database/client';
import { cleanupStaleSessions, processExpiredUserSubscriptions } from './src/services/sessionCleanupService';
import { createLogger } from './src/utils/logger';

async function main() {
  // Initialize with config from environment
  initializePrismaClient(
    {
      url: process.env.DATABASE_URL || 'postgresql://devuser:devpass@localhost:5432/dev_db',
    },
    createLogger()
  );

  console.log('\n🔍 Session Cleanup - Manual Run\n');
  console.log('ℹ️  Note: The cron job runs inside your server process.');
  console.log('   Check server logs for "🚀 Starting session cleanup job..." to verify.\n');

  console.log('📊 Running cleanup tasks manually:\n');

  console.log('1. Checking for stale PENDING sessions...');
  const staleCount = await cleanupStaleSessions(undefined, true);
  console.log(`   → Cleaned up ${staleCount} stale session(s)\n`);

  console.log('2. Checking for expired user subscriptions...');
  const { graceCount, expiredCount } = await processExpiredUserSubscriptions(true);
  console.log(`   → ${graceCount} user(s) moved to GRACE`);
  console.log(`   → ${expiredCount} user(s) moved to EXPIRED\n`);

  console.log('✅ Manual cleanup complete.\n');

  await disconnectPrisma();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});

