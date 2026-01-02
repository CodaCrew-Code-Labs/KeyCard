import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';

// Store tenant context in async local storage
class TenantContext {
  private static currentTenantId: string | null = null;
  private static currentUserId: string | null = null;

  static setTenant(tenantId: string, userId: string): void {
    this.currentTenantId = tenantId;
    this.currentUserId = userId;
  }

  static getTenantId(): string | null {
    return this.currentTenantId;
  }

  static getUserId(): string | null {
    return this.currentUserId;
  }

  static clear(): void {
    this.currentTenantId = null;
    this.currentUserId = null;
  }
}

export { TenantContext };

/**
 * Middleware to set tenant context from authenticated request
 */
export function tenantContextMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.auth) {
      TenantContext.setTenant(req.auth.tenantId, req.auth.userId);
    }

    // Clear context after request completes
    res.on('finish', () => {
      TenantContext.clear();
    });

    next();
  };
}

/**
 * Get current tenant ID from context
 */
export function getCurrentTenantId(): string {
  const tenantId = TenantContext.getTenantId();
  if (!tenantId) {
    throw new Error('No tenant context found. Ensure authentication middleware is applied.');
  }
  return tenantId;
}

/**
 * Get current user ID from context
 */
export function getCurrentUserId(): string {
  const userId = TenantContext.getUserId();
  if (!userId) {
    throw new Error('No user context found. Ensure authentication middleware is applied.');
  }
  return userId;
}
