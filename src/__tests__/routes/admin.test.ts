import express, { Express } from 'express';
import request from 'supertest';

// Mock the session cleanup service
jest.mock('../../services/sessionCleanupService', () => ({
  isCleanupJobRunning: jest.fn(),
}));

// Create mock objects for Prisma
const mockSession = {
  count: jest.fn(),
};

const mockUserMapping = {
  count: jest.fn(),
};

// Mock the database client
jest.mock('../../database/client', () => ({
  getPrismaClient: jest.fn(() => ({
    session: mockSession,
    userMapping: mockUserMapping,
  })),
}));

// Import after mocks are set up
import adminRouter from '../../routes/admin';
import { isCleanupJobRunning } from '../../services/sessionCleanupService';

describe('Admin Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminRouter);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('GET /api/v1/admin/cron-status', () => {
    it('should return cron status when job is running', async () => {
      (isCleanupJobRunning as jest.Mock).mockReturnValue(true);
      mockSession.count.mockResolvedValue(5);
      mockUserMapping.count
        .mockResolvedValueOnce(3) // GRACE users
        .mockResolvedValueOnce(2); // EXPIRED users

      const response = await request(app).get('/api/v1/admin/cron-status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        cronJob: {
          running: true,
          intervalMinutes: 5,
          sessionTimeoutMinutes: 30,
        },
        stats: {
          pendingSessions: 5,
          usersInGracePeriod: 3,
          usersExpired: 2,
        },
      });
    });

    it('should return cron status when job is not running', async () => {
      (isCleanupJobRunning as jest.Mock).mockReturnValue(false);
      mockSession.count.mockResolvedValue(0);
      mockUserMapping.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const response = await request(app).get('/api/v1/admin/cron-status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        cronJob: {
          running: false,
          intervalMinutes: 5,
          sessionTimeoutMinutes: 30,
        },
        stats: {
          pendingSessions: 0,
          usersInGracePeriod: 0,
          usersExpired: 0,
        },
      });
    });

    it('should query database with correct filters', async () => {
      (isCleanupJobRunning as jest.Mock).mockReturnValue(true);
      mockSession.count.mockResolvedValue(0);
      mockUserMapping.count.mockResolvedValue(0);

      await request(app).get('/api/v1/admin/cron-status');

      expect(mockSession.count).toHaveBeenCalledWith({
        where: { status: 'PENDING' },
      });
      expect(mockUserMapping.count).toHaveBeenCalledWith({
        where: { subscriptionStatus: 'GRACE' },
      });
      expect(mockUserMapping.count).toHaveBeenCalledWith({
        where: { subscriptionStatus: 'EXPIRED' },
      });
    });

    it('should return 500 on database error', async () => {
      (isCleanupJobRunning as jest.Mock).mockReturnValue(true);
      mockSession.count.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app).get('/api/v1/admin/cron-status');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Failed to get cron status',
      });
    });

    it('should return 500 when userMapping count fails', async () => {
      (isCleanupJobRunning as jest.Mock).mockReturnValue(true);
      mockSession.count.mockResolvedValue(0);
      mockUserMapping.count.mockRejectedValue(new Error('Query error'));

      const response = await request(app).get('/api/v1/admin/cron-status');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Failed to get cron status',
      });
    });

    it('should handle large numbers correctly', async () => {
      (isCleanupJobRunning as jest.Mock).mockReturnValue(true);
      mockSession.count.mockResolvedValue(10000);
      mockUserMapping.count.mockResolvedValueOnce(5000).mockResolvedValueOnce(2500);

      const response = await request(app).get('/api/v1/admin/cron-status');

      expect(response.status).toBe(200);
      expect(response.body.stats).toEqual({
        pendingSessions: 10000,
        usersInGracePeriod: 5000,
        usersExpired: 2500,
      });
    });
  });
});
