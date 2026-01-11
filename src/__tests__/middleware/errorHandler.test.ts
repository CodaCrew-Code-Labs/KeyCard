import { Request, Response, NextFunction } from 'express';
import { errorHandler, notFoundHandler } from '../../middleware/errorHandler';
import { SubscriptionError } from '../../types';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ZodError, ZodIssue } from 'zod';

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-request-id'),
}));

describe('Error Handler Middleware', () => {
  let mockRequest: { method: string; path: string };
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      method: 'GET',
      path: '/test/path',
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();

    // Suppress console.error for cleaner test output
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('errorHandler', () => {
    it('should handle SubscriptionError', () => {
      const error = new SubscriptionError('resource_not_found', 'Resource not found', 404, {
        resourceId: '123',
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'resource_not_found',
          message: 'Resource not found',
          details: { resourceId: '123' },
          requestId: 'test-request-id',
        },
      });
    });

    it('should handle SubscriptionError without details', () => {
      const error = new SubscriptionError('bad_request', 'Bad request', 400);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'bad_request',
          message: 'Bad request',
          details: undefined,
          requestId: 'test-request-id',
        },
      });
    });

    it('should handle Prisma P2002 (unique constraint) error', () => {
      const error = new PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['email'] },
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'resource_conflict',
          message: 'A resource with these values already exists',
          details: { target: ['email'] },
          requestId: 'test-request-id',
        },
      });
    });

    it('should handle Prisma P2025 (record not found) error', () => {
      const error = new PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'resource_not_found',
          message: 'Resource not found',
          requestId: 'test-request-id',
        },
      });
    });

    it('should handle ZodError (validation error)', () => {
      const zodIssues: ZodIssue[] = [
        {
          code: 'invalid_type',
          expected: 'string',
          path: ['email'],
          message: 'Expected string, received number',
        },
      ];
      const error = new ZodError(zodIssues);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'validation_error',
          message: 'Invalid request data',
          details: zodIssues,
          requestId: 'test-request-id',
        },
      });
    });

    it('should handle generic errors with 500 status', () => {
      const error = new Error('Something went wrong');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'internal_server_error',
          message: 'An unexpected error occurred',
          requestId: 'test-request-id',
        },
      });
      expect(console.error).toHaveBeenCalledWith('Unhandled error:', error);
    });

    it('should handle unknown Prisma errors with 500 status', () => {
      const error = new PrismaClientKnownRequestError('Unknown error', {
        code: 'P9999',
        clientVersion: '5.0.0',
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'internal_server_error',
          message: 'An unexpected error occurred',
          requestId: 'test-request-id',
        },
      });
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 with route information', () => {
      const req = { method: 'POST', path: '/api/v1/nonexistent' };

      notFoundHandler(req as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'route_not_found',
          message: 'Route POST /api/v1/nonexistent not found',
        },
      });
    });

    it('should handle GET request not found', () => {
      const req = { method: 'GET', path: '/missing/route' };

      notFoundHandler(req as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: 'route_not_found',
          message: 'Route GET /missing/route not found',
        },
      });
    });
  });
});
