import { getPrismaClient } from '../database/client';
import { SessionStatus, SubscriptionStatus } from '@prisma/client';

// Default timeout: 30 minutes
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
// Default cleanup interval: 5 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
// Grace period: 7 days in milliseconds
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

let cleanupIntervalId: NodeJS.Timeout | null = null;

export interface SessionCleanupConfig {
  /** Session timeout in milliseconds (default: 30 minutes) */
  sessionTimeoutMs?: number;
  /** Cleanup interval in milliseconds (default: 5 minutes) */
  cleanupIntervalMs?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Marks stale PENDING sessions as EXPIRED
 * A session is considered stale if it's been in PENDING status longer than the timeout
 */
export async function cleanupStaleSessions(
  sessionTimeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
  verbose: boolean = false
): Promise<number> {
  const cutoffDate = new Date(Date.now() - sessionTimeoutMs);

  const result = await getPrismaClient().session.updateMany({
    where: {
      status: SessionStatus.PENDING,
      createdDate: {
        lt: cutoffDate,
      },
    },
    data: {
      status: SessionStatus.EXPIRED,
    },
  });

  if (result.count > 0 || verbose) {
    console.log(
      `🧹 Session cleanup: marked ${result.count} stale session(s) as EXPIRED (older than ${sessionTimeoutMs / 60000} minutes)`
    );
  }

  return result.count;
}

/**
 * Processes pending tier changes that have reached their effective date
 * This is a backup mechanism - primary application happens in handleSubscriptionRenewed
 * This catches any pending changes that might have been missed (e.g., webhook failures)
 */
export async function processPendingTierChanges(verbose: boolean = false): Promise<number> {
  const now = new Date();

  // Find users with pending changes that should have taken effect
  const usersWithPendingChanges = await getPrismaClient().userMapping.findMany({
    where: {
      pendingTier: { not: null },
      pendingTierEffectiveDate: { lte: now },
    },
  });

  let appliedCount = 0;

  for (const user of usersWithPendingChanges) {
    try {
      await getPrismaClient().userMapping.update({
        where: { userUuid: user.userUuid },
        data: {
          activeTier: user.pendingTier,
          activeLength: user.pendingActiveLength,
          // Clear pending fields after applying
          pendingTier: null,
          pendingActiveLength: null,
          pendingTierEffectiveDate: null,
          pendingChangeType: null,
        },
      });

      appliedCount++;
      console.log(
        `📅 Applied pending tier change for user ${user.userUuid}: ${user.activeTier} → ${user.pendingTier}`
      );
    } catch (error) {
      console.error(`❌ Failed to apply pending tier change for user ${user.userUuid}:`, error);
    }
  }

  if (appliedCount > 0 || verbose) {
    console.log(`🔄 Pending tier changes: applied ${appliedCount} change(s)`);
  }

  return appliedCount;
}

/**
 * Processes expired user subscriptions with grace period logic
 * - If tier_expires_at is in the past but within 7 days → update status to GRACE
 * - If tier_expires_at is more than 7 days in the past → update status to EXPIRED
 * Only processes users whose status is NOT ACTIVE and NOT EXPIRED
 */
export async function processExpiredUserSubscriptions(
  verbose: boolean = false
): Promise<{ graceCount: number; expiredCount: number }> {
  const now = new Date();
  const graceCutoffDate = new Date(now.getTime() - GRACE_PERIOD_MS);

  // First, update users within grace period to GRACE status
  // Only if they are not already ACTIVE or EXPIRED
  const graceResult = await getPrismaClient().userMapping.updateMany({
    where: {
      tierExpiresAt: {
        lt: now,
        gte: graceCutoffDate,
      },
      subscriptionStatus: {
        notIn: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED],
      },
    },
    data: {
      subscriptionStatus: SubscriptionStatus.GRACE,
    },
  });

  // Then, update users past grace period to EXPIRED status
  // Only if they are not already ACTIVE or EXPIRED
  const expiredResult = await getPrismaClient().userMapping.updateMany({
    where: {
      tierExpiresAt: {
        lt: graceCutoffDate,
      },
      subscriptionStatus: {
        notIn: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED],
      },
    },
    data: {
      subscriptionStatus: SubscriptionStatus.EXPIRED,
    },
  });

  if (graceResult.count > 0 || expiredResult.count > 0 || verbose) {
    console.log(
      `👤 User subscription cleanup: marked ${graceResult.count} user(s) as GRACE, ${expiredResult.count} user(s) as EXPIRED`
    );
  }

  return {
    graceCount: graceResult.count,
    expiredCount: expiredResult.count,
  };
}

/**
 * Starts the periodic session cleanup job
 */
export function startSessionCleanupJob(config: SessionCleanupConfig = {}): void {
  const {
    sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS,
    cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
    verbose = false,
  } = config;

  // Don't start if already running
  if (cleanupIntervalId) {
    console.log('⚠️ Session cleanup job is already running');
    return;
  }

  console.log(
    `🚀 Starting session cleanup job (interval: ${cleanupIntervalMs / 60000} min, timeout: ${sessionTimeoutMs / 60000} min)`
  );

  // Run immediately on start
  cleanupStaleSessions(sessionTimeoutMs, verbose).catch((err) => {
    console.error('❌ Session cleanup error:', err);
  });
  processExpiredUserSubscriptions(verbose).catch((err) => {
    console.error('❌ User subscription cleanup error:', err);
  });
  processPendingTierChanges(verbose).catch((err) => {
    console.error('❌ Pending tier changes error:', err);
  });

  // Then run periodically
  cleanupIntervalId = setInterval(() => {
    cleanupStaleSessions(sessionTimeoutMs, verbose).catch((err) => {
      console.error('❌ Session cleanup error:', err);
    });
    processExpiredUserSubscriptions(verbose).catch((err) => {
      console.error('❌ User subscription cleanup error:', err);
    });
    processPendingTierChanges(verbose).catch((err) => {
      console.error('❌ Pending tier changes error:', err);
    });
  }, cleanupIntervalMs);
}

/**
 * Stops the periodic session cleanup job
 */
export function stopSessionCleanupJob(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    console.log('🛑 Session cleanup job stopped');
  }
}

/**
 * Check if cleanup job is running
 */
export function isCleanupJobRunning(): boolean {
  return cleanupIntervalId !== null;
}
