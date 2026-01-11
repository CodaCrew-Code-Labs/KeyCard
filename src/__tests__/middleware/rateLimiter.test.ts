import express, { Express } from 'express';
import request from 'supertest';
import { createRateLimiter } from '../../middleware/rateLimiter';

describe('Rate Limiter Middleware', () => {
  let app: Express;

  describe('createRateLimiter', () => {
    it('should create rate limiter with default config', async () => {
      app = express();
      app.use(createRateLimiter());
      app.get('/test', (_req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.headers['ratelimit-limit']).toBe('100');
      expect(response.headers['ratelimit-remaining']).toBe('99');
    });

    it('should create rate limiter with custom config', async () => {
      app = express();
      app.use(createRateLimiter({ windowMs: 60000, max: 5 }));
      app.get('/test', (_req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.headers['ratelimit-limit']).toBe('5');
      expect(response.headers['ratelimit-remaining']).toBe('4');
    });

    it('should return 429 when rate limit is exceeded', async () => {
      app = express();
      app.use(createRateLimiter({ windowMs: 60000, max: 2 }));
      app.get('/test', (_req, res) => res.json({ success: true }));

      // First two requests should succeed
      await request(app).get('/test');
      await request(app).get('/test');

      // Third request should be rate limited
      const response = await request(app).get('/test');

      expect(response.status).toBe(429);
      expect(response.body).toEqual({
        error: {
          code: 'rate_limit_exceeded',
          message: 'Too many requests, please try again later',
        },
      });
    });

    it('should track rate limits per IP', async () => {
      app = express();
      app.set('trust proxy', true);
      app.use(createRateLimiter({ windowMs: 60000, max: 2 }));
      app.get('/test', (_req, res) => res.json({ success: true }));

      // Requests from first IP
      await request(app).get('/test').set('X-Forwarded-For', '1.1.1.1');
      await request(app).get('/test').set('X-Forwarded-For', '1.1.1.1');

      // Third request from first IP should be limited
      const limitedResponse = await request(app).get('/test').set('X-Forwarded-For', '1.1.1.1');
      expect(limitedResponse.status).toBe(429);

      // Request from second IP should succeed
      const secondIpResponse = await request(app).get('/test').set('X-Forwarded-For', '2.2.2.2');
      expect(secondIpResponse.status).toBe(200);
    });

    it('should use standard headers and not legacy headers', async () => {
      app = express();
      app.use(createRateLimiter());
      app.get('/test', (_req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');

      // Standard headers should be present
      expect(response.headers['ratelimit-limit']).toBeDefined();
      expect(response.headers['ratelimit-remaining']).toBeDefined();

      // Legacy headers should not be present
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      expect(response.headers['x-ratelimit-remaining']).toBeUndefined();
    });

    it('should override default config with custom values', async () => {
      app = express();
      app.use(createRateLimiter({ windowMs: 30000, max: 50 }));
      app.get('/test', (_req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');

      expect(response.headers['ratelimit-limit']).toBe('50');
    });

    it('should partially override config (only max)', async () => {
      app = express();
      app.use(createRateLimiter({ windowMs: 15 * 60 * 1000, max: 25 }));
      app.get('/test', (_req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');

      expect(response.headers['ratelimit-limit']).toBe('25');
    });
  });
});
