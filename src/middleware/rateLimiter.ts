import rateLimit from 'express-rate-limit';
import { RateLimitConfig } from '../types';

/**
 * Create rate limiter middleware
 */
export function createRateLimiter(config?: RateLimitConfig) {
  const defaultConfig: RateLimitConfig = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
  };

  const finalConfig = { ...defaultConfig, ...config };

  return rateLimit({
    windowMs: finalConfig.windowMs,
    max: finalConfig.max,
    message: {
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many requests, please try again later',
      },
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
}
