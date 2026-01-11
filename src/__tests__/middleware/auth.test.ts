import { Response, NextFunction } from 'express';
import { createAuthMiddleware } from '../../middleware/auth';
import { AuthConfig, AuthenticatedRequest, SubscriptionError } from '../../types';

describe('Auth Middleware', () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      body: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe('createAuthMiddleware', () => {
    it('should call next() when authentication is valid', async () => {
      const authConfig: AuthConfig = {
        validateRequest: jest.fn().mockResolvedValue({
          isValid: true,
          userId: 'user-123',
          tenantId: 'tenant-456',
        }),
      };

      const middleware = createAuthMiddleware(authConfig);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(authConfig.validateRequest).toHaveBeenCalledWith(mockRequest);
      expect(mockRequest.auth).toEqual({
        isValid: true,
        userId: 'user-123',
        tenantId: 'tenant-456',
      });
      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should return 401 when authentication is invalid', async () => {
      const authConfig: AuthConfig = {
        validateRequest: jest.fn().mockResolvedValue({
          isValid: false,
          userId: '',
          tenantId: '',
        }),
      };

      const middleware = createAuthMiddleware(authConfig);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'authentication_failed',
          message: 'Invalid or missing authentication credentials',
          details: undefined,
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle SubscriptionError thrown by validateRequest', async () => {
      const authConfig: AuthConfig = {
        validateRequest: jest
          .fn()
          .mockRejectedValue(
            new SubscriptionError('custom_error', 'Custom error message', 403, { detail: 'info' })
          ),
      };

      const middleware = createAuthMiddleware(authConfig);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'custom_error',
          message: 'Custom error message',
          details: { detail: 'info' },
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return generic 401 for non-SubscriptionError exceptions', async () => {
      const authConfig: AuthConfig = {
        validateRequest: jest.fn().mockRejectedValue(new Error('Unexpected error')),
      };

      const middleware = createAuthMiddleware(authConfig);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'authentication_failed',
          message: 'Authentication failed',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should pass the full request object to validateRequest', async () => {
      const authConfig: AuthConfig = {
        validateRequest: jest.fn().mockResolvedValue({
          isValid: true,
          userId: 'user-123',
          tenantId: 'tenant-456',
        }),
      };

      mockRequest = {
        headers: { authorization: 'Bearer token123' },
        body: { data: 'test' },
        query: { param: 'value' },
      };

      const middleware = createAuthMiddleware(authConfig);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(authConfig.validateRequest).toHaveBeenCalledWith(mockRequest);
    });
  });
});
