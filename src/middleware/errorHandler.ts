import { Request, Response, NextFunction } from 'express';
import { SubscriptionError } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Global error handler middleware
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = uuidv4();

  if (error instanceof SubscriptionError) {
    return res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId,
      },
    });
  }

  // Handle Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as any;

    if (prismaError.code === 'P2002') {
      return res.status(409).json({
        error: {
          code: 'resource_conflict',
          message: 'A resource with these values already exists',
          details: prismaError.meta,
          requestId,
        },
      });
    }

    if (prismaError.code === 'P2025') {
      return res.status(404).json({
        error: {
          code: 'resource_not_found',
          message: 'Resource not found',
          requestId,
        },
      });
    }
  }

  // Handle validation errors (Zod)
  if (error.name === 'ZodError') {
    return res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Invalid request data',
        details: (error as any).errors,
        requestId,
      },
    });
  }

  // Default internal server error
  console.error('Unhandled error:', error);

  return res.status(500).json({
    error: {
      code: 'internal_server_error',
      message: 'An unexpected error occurred',
      requestId,
    },
  });
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: 'route_not_found',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}
