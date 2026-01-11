import { Response, NextFunction } from 'express';
import {
  TenantContext,
  tenantContextMiddleware,
  getCurrentTenantId,
  getCurrentUserId,
} from '../../middleware/tenantContext';
import { AuthenticatedRequest } from '../../types';

describe('Tenant Context', () => {
  beforeEach(() => {
    // Clear context before each test
    TenantContext.clear();
  });

  describe('TenantContext class', () => {
    it('should set and get tenant context', () => {
      TenantContext.setTenant('tenant-123', 'user-456');

      expect(TenantContext.getTenantId()).toBe('tenant-123');
      expect(TenantContext.getUserId()).toBe('user-456');
    });

    it('should return null when context is not set', () => {
      expect(TenantContext.getTenantId()).toBeNull();
      expect(TenantContext.getUserId()).toBeNull();
    });

    it('should clear context', () => {
      TenantContext.setTenant('tenant-123', 'user-456');
      TenantContext.clear();

      expect(TenantContext.getTenantId()).toBeNull();
      expect(TenantContext.getUserId()).toBeNull();
    });

    it('should overwrite existing context when set again', () => {
      TenantContext.setTenant('tenant-1', 'user-1');
      TenantContext.setTenant('tenant-2', 'user-2');

      expect(TenantContext.getTenantId()).toBe('tenant-2');
      expect(TenantContext.getUserId()).toBe('user-2');
    });
  });

  describe('tenantContextMiddleware', () => {
    let mockRequest: Partial<AuthenticatedRequest>;
    let mockResponse: { on: jest.Mock };
    let mockNext: NextFunction;
    let finishCallback: (() => void) | null = null;

    beforeEach(() => {
      mockRequest = {};
      mockResponse = {
        on: jest.fn((event: string, callback: () => void) => {
          if (event === 'finish') {
            finishCallback = callback;
          }
          return mockResponse;
        }),
      };
      mockNext = jest.fn();
      finishCallback = null;
    });

    it('should set tenant context from authenticated request', () => {
      mockRequest.auth = {
        isValid: true,
        tenantId: 'tenant-abc',
        userId: 'user-xyz',
      };

      const middleware = tenantContextMiddleware();
      middleware(
        mockRequest as AuthenticatedRequest,
        mockResponse as unknown as Response,
        mockNext
      );

      expect(TenantContext.getTenantId()).toBe('tenant-abc');
      expect(TenantContext.getUserId()).toBe('user-xyz');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should not set context when auth is not present', () => {
      mockRequest.auth = undefined;

      const middleware = tenantContextMiddleware();
      middleware(
        mockRequest as AuthenticatedRequest,
        mockResponse as unknown as Response,
        mockNext
      );

      expect(TenantContext.getTenantId()).toBeNull();
      expect(TenantContext.getUserId()).toBeNull();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should clear context when response finishes', () => {
      mockRequest.auth = {
        isValid: true,
        tenantId: 'tenant-abc',
        userId: 'user-xyz',
      };

      const middleware = tenantContextMiddleware();
      middleware(
        mockRequest as AuthenticatedRequest,
        mockResponse as unknown as Response,
        mockNext
      );

      // Verify context is set
      expect(TenantContext.getTenantId()).toBe('tenant-abc');

      // Simulate response finish
      expect(finishCallback).not.toBeNull();
      finishCallback!();

      // Context should be cleared
      expect(TenantContext.getTenantId()).toBeNull();
      expect(TenantContext.getUserId()).toBeNull();
    });

    it('should register finish handler on response', () => {
      const middleware = tenantContextMiddleware();
      middleware(
        mockRequest as AuthenticatedRequest,
        mockResponse as unknown as Response,
        mockNext
      );

      expect(mockResponse.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });
  });

  describe('getCurrentTenantId', () => {
    it('should return tenant ID when context is set', () => {
      TenantContext.setTenant('tenant-123', 'user-456');

      expect(getCurrentTenantId()).toBe('tenant-123');
    });

    it('should throw error when context is not set', () => {
      expect(() => getCurrentTenantId()).toThrow(
        'No tenant context found. Ensure authentication middleware is applied.'
      );
    });
  });

  describe('getCurrentUserId', () => {
    it('should return user ID when context is set', () => {
      TenantContext.setTenant('tenant-123', 'user-456');

      expect(getCurrentUserId()).toBe('user-456');
    });

    it('should throw error when context is not set', () => {
      expect(() => getCurrentUserId()).toThrow(
        'No user context found. Ensure authentication middleware is applied.'
      );
    });
  });
});
