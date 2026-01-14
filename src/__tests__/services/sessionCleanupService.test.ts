import { SessionStatus, SubscriptionStatus } from '@prisma/client';

// Mock the database client
const mockSession = {
  updateMany: jest.fn(),
};

const mockUserMapping = {
  findMany: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};

jest.mock('../../database/client', () => ({
  getPrismaClient: jest.fn(() => ({
    session: mockSession,
    userMapping: mockUserMapping,
  })),
}));

// Import after mocks are set up
import {
  cleanupStaleSessions,
  processPendingTierChanges,
  processExpiredUserSubscriptions,
  startSessionCleanupJob,
  stopSessionCleanupJob,
  isCleanupJobRunning,
} from '../../services/sessionCleanupService';

describe('sessionCleanupService', () => {
  // Store original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Ensure cleanup job is stopped before each test
    stopSessionCleanupJob();
    // Mock console methods to suppress output during tests
    console.log = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    // Clean up timers and intervals
    jest.clearAllTimers();
    jest.useRealTimers();
    stopSessionCleanupJob();
  });

  describe('cleanupStaleSessions', () => {
    it('should mark stale PENDING sessions as EXPIRED', async () => {
      mockSession.updateMany.mockResolvedValue({ count: 5 });

      const result = await cleanupStaleSessions();

      expect(result).toBe(5);
      expect(mockSession.updateMany).toHaveBeenCalledWith({
        where: {
          status: SessionStatus.PENDING,
          createdDate: {
            lt: expect.any(Date),
          },
        },
        data: {
          status: SessionStatus.EXPIRED,
        },
      });
    });

    it('should use custom timeout when provided', async () => {
      mockSession.updateMany.mockResolvedValue({ count: 0 });
      const customTimeout = 60 * 60 * 1000; // 1 hour

      await cleanupStaleSessions(customTimeout);

      // Verify the cutoff date calculation uses custom timeout
      const callArg = mockSession.updateMany.mock.calls[0][0];
      const now = Date.now();
      const cutoffTime = callArg.where.createdDate.lt.getTime();
      // The cutoff should be approximately now - customTimeout
      expect(now - cutoffTime).toBeCloseTo(customTimeout, -3); // within 1000ms
    });

    it('should return 0 when no stale sessions found', async () => {
      mockSession.updateMany.mockResolvedValue({ count: 0 });

      const result = await cleanupStaleSessions();

      expect(result).toBe(0);
    });

    it('should log when verbose mode is enabled', async () => {
      mockSession.updateMany.mockResolvedValue({ count: 0 });

      await cleanupStaleSessions(30 * 60 * 1000, true);

      expect(console.log).toHaveBeenCalled();
    });

    it('should log when sessions are cleaned up', async () => {
      mockSession.updateMany.mockResolvedValue({ count: 3 });

      await cleanupStaleSessions();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('marked 3 stale session(s) as EXPIRED')
      );
    });
  });

  describe('processPendingTierChanges', () => {
    it('should apply pending tier changes that have reached effective date', async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 1000);

      mockUserMapping.findMany.mockResolvedValue([
        {
          userUuid: 'user-1',
          activeTier: 'BASIC',
          activeLength: 'MONTHLY',
          pendingTier: 'PRO',
          pendingActiveLength: 'YEARLY',
          pendingTierEffectiveDate: pastDate,
          pendingChangeType: 'DEFERRED_DOWNGRADE',
        },
      ]);
      mockUserMapping.update.mockResolvedValue({});

      const result = await processPendingTierChanges();

      expect(result).toBe(1);
      expect(mockUserMapping.findMany).toHaveBeenCalledWith({
        where: {
          pendingTier: { not: null },
          pendingTierEffectiveDate: { lte: expect.any(Date) },
        },
      });
      expect(mockUserMapping.update).toHaveBeenCalledWith({
        where: { userUuid: 'user-1' },
        data: {
          activeTier: 'PRO',
          activeLength: 'YEARLY',
          pendingTier: null,
          pendingActiveLength: null,
          pendingTierEffectiveDate: null,
          pendingChangeType: null,
        },
      });
    });

    it('should handle multiple users with pending changes', async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 1000);

      mockUserMapping.findMany.mockResolvedValue([
        {
          userUuid: 'user-1',
          pendingTier: 'PRO',
          pendingActiveLength: 'MONTHLY',
          pendingTierEffectiveDate: pastDate,
        },
        {
          userUuid: 'user-2',
          pendingTier: 'BASIC',
          pendingActiveLength: 'YEARLY',
          pendingTierEffectiveDate: pastDate,
        },
      ]);
      mockUserMapping.update.mockResolvedValue({});

      const result = await processPendingTierChanges();

      expect(result).toBe(2);
      expect(mockUserMapping.update).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when no pending changes found', async () => {
      mockUserMapping.findMany.mockResolvedValue([]);

      const result = await processPendingTierChanges();

      expect(result).toBe(0);
    });

    it('should handle errors for individual users gracefully', async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 1000);

      mockUserMapping.findMany.mockResolvedValue([
        {
          userUuid: 'user-1',
          pendingTier: 'PRO',
          pendingActiveLength: 'MONTHLY',
          pendingTierEffectiveDate: pastDate,
        },
        {
          userUuid: 'user-2',
          pendingTier: 'BASIC',
          pendingActiveLength: 'YEARLY',
          pendingTierEffectiveDate: pastDate,
        },
      ]);
      // First call fails, second succeeds
      mockUserMapping.update
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({});

      const result = await processPendingTierChanges();

      // Only 1 successful update
      expect(result).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to apply pending tier change for user user-1'),
        expect.any(Error)
      );
    });

    it('should log when verbose mode is enabled', async () => {
      mockUserMapping.findMany.mockResolvedValue([]);

      await processPendingTierChanges(true);

      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('processExpiredUserSubscriptions', () => {
    it('should mark users within grace period as GRACE status', async () => {
      mockUserMapping.updateMany
        .mockResolvedValueOnce({ count: 3 }) // grace updates
        .mockResolvedValueOnce({ count: 0 }); // expired updates

      const result = await processExpiredUserSubscriptions();

      expect(result).toEqual({ graceCount: 3, expiredCount: 0 });
      expect(mockUserMapping.updateMany).toHaveBeenCalledTimes(2);

      // First call for grace period users
      const graceCall = mockUserMapping.updateMany.mock.calls[0][0];
      expect(graceCall.data.subscriptionStatus).toBe(SubscriptionStatus.GRACE);
      expect(graceCall.where.subscriptionStatus.notIn).toContain(SubscriptionStatus.ACTIVE);
      expect(graceCall.where.subscriptionStatus.notIn).toContain(SubscriptionStatus.EXPIRED);
    });

    it('should mark users past grace period as EXPIRED status', async () => {
      mockUserMapping.updateMany
        .mockResolvedValueOnce({ count: 0 }) // grace updates
        .mockResolvedValueOnce({ count: 5 }); // expired updates

      const result = await processExpiredUserSubscriptions();

      expect(result).toEqual({ graceCount: 0, expiredCount: 5 });

      // Second call for expired users
      const expiredCall = mockUserMapping.updateMany.mock.calls[1][0];
      expect(expiredCall.data.subscriptionStatus).toBe(SubscriptionStatus.EXPIRED);
    });

    it('should handle both grace and expired users', async () => {
      mockUserMapping.updateMany
        .mockResolvedValueOnce({ count: 2 }) // grace
        .mockResolvedValueOnce({ count: 3 }); // expired

      const result = await processExpiredUserSubscriptions();

      expect(result).toEqual({ graceCount: 2, expiredCount: 3 });
    });

    it('should return zero counts when no users need updating', async () => {
      mockUserMapping.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });

      const result = await processExpiredUserSubscriptions();

      expect(result).toEqual({ graceCount: 0, expiredCount: 0 });
    });

    it('should log when users are updated', async () => {
      mockUserMapping.updateMany
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 1 });

      await processExpiredUserSubscriptions();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('marked 2 user(s) as GRACE, 1 user(s) as EXPIRED')
      );
    });

    it('should log when verbose mode is enabled', async () => {
      mockUserMapping.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });

      await processExpiredUserSubscriptions(true);

      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('startSessionCleanupJob', () => {
    beforeEach(() => {
      // Setup default successful mocks
      mockSession.updateMany.mockResolvedValue({ count: 0 });
      mockUserMapping.findMany.mockResolvedValue([]);
      mockUserMapping.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });
    });

    it('should start the cleanup job and run immediately', async () => {
      startSessionCleanupJob();

      // Allow promises to resolve
      await Promise.resolve();

      expect(isCleanupJobRunning()).toBe(true);
      // Should have called cleanup functions immediately
      expect(mockSession.updateMany).toHaveBeenCalled();
    });

    it('should not start if already running', () => {
      startSessionCleanupJob();
      startSessionCleanupJob(); // Try to start again

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('already running'));
    });

    it('should use custom configuration', () => {
      startSessionCleanupJob({
        sessionTimeoutMs: 60000,
        cleanupIntervalMs: 120000,
        verbose: true,
      });

      expect(isCleanupJobRunning()).toBe(true);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('interval: 2 min'));
    });

    it('should run cleanup periodically', async () => {
      // Reset mocks for counting
      mockSession.updateMany.mockResolvedValue({ count: 0 });
      mockUserMapping.findMany.mockResolvedValue([]);
      mockUserMapping.updateMany.mockResolvedValue({ count: 0 });

      startSessionCleanupJob({ cleanupIntervalMs: 1000 });

      // Initial call
      await Promise.resolve();
      const initialCalls = mockSession.updateMany.mock.calls.length;

      // Advance timer by one interval
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Should have additional calls after interval
      expect(mockSession.updateMany.mock.calls.length).toBeGreaterThan(initialCalls);
    });

    it('should handle errors in cleanup functions gracefully', async () => {
      mockSession.updateMany.mockRejectedValue(new Error('DB error'));

      startSessionCleanupJob();

      // Allow error to be caught
      await Promise.resolve();
      await Promise.resolve();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Session cleanup error'),
        expect.any(Error)
      );
      // Job should still be running
      expect(isCleanupJobRunning()).toBe(true);
    });
  });

  describe('stopSessionCleanupJob', () => {
    beforeEach(() => {
      mockSession.updateMany.mockResolvedValue({ count: 0 });
      mockUserMapping.findMany.mockResolvedValue([]);
      mockUserMapping.updateMany.mockResolvedValue({ count: 0 });
    });

    it('should stop a running cleanup job', () => {
      startSessionCleanupJob();
      expect(isCleanupJobRunning()).toBe(true);

      stopSessionCleanupJob();

      expect(isCleanupJobRunning()).toBe(false);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('stopped'));
    });

    it('should do nothing if job is not running', () => {
      // Clear any previous console.log calls
      (console.log as jest.Mock).mockClear();

      stopSessionCleanupJob();

      // Should not log "stopped" message since job wasn't running
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('stopped'));
    });
  });

  describe('isCleanupJobRunning', () => {
    beforeEach(() => {
      mockSession.updateMany.mockResolvedValue({ count: 0 });
      mockUserMapping.findMany.mockResolvedValue([]);
      mockUserMapping.updateMany.mockResolvedValue({ count: 0 });
    });

    it('should return false initially', () => {
      expect(isCleanupJobRunning()).toBe(false);
    });

    it('should return true when job is started', () => {
      startSessionCleanupJob();

      expect(isCleanupJobRunning()).toBe(true);
    });

    it('should return false after job is stopped', () => {
      startSessionCleanupJob();
      stopSessionCleanupJob();

      expect(isCleanupJobRunning()).toBe(false);
    });
  });
});
