import { Response, NextFunction } from 'express';
import { AuthConfig, AuthenticatedRequest, SubscriptionError } from '../types';

/**
 * Authentication middleware factory
 */
export function createAuthMiddleware(authConfig: AuthConfig) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const authResult = await authConfig.validateRequest(req);

      if (!authResult.isValid) {
        throw new SubscriptionError(
          'authentication_failed',
          'Invalid or missing authentication credentials',
          401
        );
      }

      // Attach auth data to request
      req.auth = authResult;

      next();
    } catch (error) {
      if (error instanceof SubscriptionError) {
        return res.status(error.statusCode).json({
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        });
      }

      return res.status(401).json({
        error: {
          code: 'authentication_failed',
          message: 'Authentication failed',
        },
      });
    }
  };
}
