import { Router, Request, Response } from 'express';
import { isCleanupJobRunning } from '../services/sessionCleanupService';
import { getPrismaClient } from '../database/client';

const router = Router();

/**
 * GET /api/v1/admin/cron-status
 * Check if the cleanup cron job is running
 */
router.get('/cron-status', async (req: Request, res: Response) => {
  try {
    const isRunning = isCleanupJobRunning();

    // Get stats
    const prisma = getPrismaClient();
    const [pendingSessions, graceUsers, expiredUsers] = await Promise.all([
      prisma.session.count({ where: { status: 'PENDING' } }),
      prisma.userMapping.count({ where: { subscriptionStatus: 'GRACE' } }),
      prisma.userMapping.count({ where: { subscriptionStatus: 'EXPIRED' } }),
    ]);

    res.json({
      success: true,
      cronJob: {
        running: isRunning,
        intervalMinutes: 5,
        sessionTimeoutMinutes: 30,
      },
      stats: {
        pendingSessions,
        usersInGracePeriod: graceUsers,
        usersExpired: expiredUsers,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cron status',
    });
  }
});

export default router;
