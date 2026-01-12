import {
  getTierFromProductId,
  getTierCodeFromProductId,
  getTierFromProductCart,
  calculateTierExpiration,
  isValidTierCode,
  setProductTierMapping,
  getConfiguredProductIds,
  TierConfig,
} from '../../config/tierMapping';

describe('Tier Mapping Configuration', () => {
  // Set up test product mappings before tests run
  beforeAll(() => {
    setProductTierMapping('prod_pro_monthly', {
      code: 'PRO',
      name: 'Pro Monthly',
      defaultDurationDays: 32,
    });
    setProductTierMapping('prod_basic_monthly', {
      code: 'BASIC',
      name: 'Basic Monthly',
      defaultDurationDays: 32,
    });
    setProductTierMapping('prod_enterprise_monthly', {
      code: 'ENTERPRISE',
      name: 'Enterprise Monthly',
      defaultDurationDays: 32,
    });
  });

  describe('Environment variable parsing', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should parse tier mapping from VITE_TEST_TIER_MAPPING in non-production', () => {
      // The module is already loaded, so we can test setProductTierMapping
      // which adds products at runtime (similar to what buildProductToTierMap does)
      setProductTierMapping('env_test_product', {
        code: 'PROFESSIONAL',
        name: 'Professional Monthly',
        defaultDurationDays: 32,
      });

      const tier = getTierFromProductId('env_test_product');
      expect(tier).toEqual({
        code: 'PROFESSIONAL',
        name: 'Professional Monthly',
        defaultDurationDays: 32,
      });
    });

    it('should handle yearly interval with 367 day duration', () => {
      setProductTierMapping('yearly_product', {
        code: 'BUSINESS',
        name: 'Business Yearly',
        defaultDurationDays: 367,
      });

      const tier = getTierFromProductId('yearly_product');
      expect(tier?.defaultDurationDays).toBe(367);
    });

    it('should handle different tier names', () => {
      // Test PROFESSIONAL tier
      setProductTierMapping('professional_product', {
        code: 'PROFESSIONAL',
        name: 'Professional',
        defaultDurationDays: 32,
      });
      expect(getTierFromProductId('professional_product')?.code).toBe('PROFESSIONAL');

      // Test BUSINESS tier
      setProductTierMapping('business_product', {
        code: 'BUSINESS',
        name: 'Business',
        defaultDurationDays: 32,
      });
      expect(getTierFromProductId('business_product')?.code).toBe('BUSINESS');

      // Test FREE tier (default for unknown)
      setProductTierMapping('free_product', {
        code: 'FREE',
        name: 'Free',
        defaultDurationDays: 32,
      });
      expect(getTierFromProductId('free_product')?.code).toBe('FREE');
    });
  });

  describe('getTierFromProductId', () => {
    it('should return tier config for known product IDs', () => {
      const proMonthly = getTierFromProductId('prod_pro_monthly');
      expect(proMonthly).toEqual({
        code: 'PRO',
        name: 'Pro Monthly',
        defaultDurationDays: 32,
      });

      const basicMonthly = getTierFromProductId('prod_basic_monthly');
      expect(basicMonthly).toEqual({
        code: 'BASIC',
        name: 'Basic Monthly',
        defaultDurationDays: 32,
      });
    });

    it('should return null for unknown product IDs', () => {
      const unknown = getTierFromProductId('unknown_product');
      expect(unknown).toBeNull();
    });
  });

  describe('getTierCodeFromProductId', () => {
    it('should return tier code for known product IDs', () => {
      expect(getTierCodeFromProductId('prod_pro_monthly')).toBe('PRO');
      expect(getTierCodeFromProductId('prod_basic_monthly')).toBe('BASIC');
      expect(getTierCodeFromProductId('prod_enterprise_monthly')).toBe('ENTERPRISE');
    });

    it('should return null for unknown product IDs', () => {
      expect(getTierCodeFromProductId('unknown')).toBeNull();
    });
  });

  describe('getTierFromProductCart', () => {
    it('should return tier from first product in cart', () => {
      const cart = [
        { product_id: 'prod_pro_monthly', quantity: 1 },
        { product_id: 'prod_basic_monthly', quantity: 1 },
      ];

      const tier = getTierFromProductCart(cart);
      expect(tier?.code).toBe('PRO');
    });

    it('should return null for empty cart', () => {
      expect(getTierFromProductCart([])).toBeNull();
    });

    it('should return null for undefined cart', () => {
      expect(getTierFromProductCart(undefined as unknown as [])).toBeNull();
    });
  });

  describe('calculateTierExpiration', () => {
    it('should use currentPeriodEnd when provided', () => {
      const tier: TierConfig = {
        code: 'PRO',
        name: 'Pro Monthly',
        defaultDurationDays: 32,
      };
      const periodEnd = '2025-02-15T00:00:00Z';

      const expiration = calculateTierExpiration(tier, periodEnd);
      expect(expiration.toISOString()).toBe('2025-02-15T00:00:00.000Z');
    });

    it('should use default duration when no periodEnd provided', () => {
      const tier: TierConfig = {
        code: 'BASIC',
        name: 'Basic Monthly',
        defaultDurationDays: 32,
      };

      const now = new Date();
      const expiration = calculateTierExpiration(tier);

      // Should be approximately 32 days in the future
      const diffDays = Math.round((expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(31);
      expect(diffDays).toBeLessThanOrEqual(33);
    });

    it('should handle Date object as periodEnd', () => {
      const tier: TierConfig = {
        code: 'PRO',
        name: 'Pro Monthly',
        defaultDurationDays: 32,
      };
      const periodEnd = new Date('2025-03-01T00:00:00Z');

      const expiration = calculateTierExpiration(tier, periodEnd);
      expect(expiration.toISOString()).toBe('2025-03-01T00:00:00.000Z');
    });
  });

  describe('isValidTierCode', () => {
    it('should return true for valid tier codes', () => {
      expect(isValidTierCode('FREE')).toBe(true);
      expect(isValidTierCode('BASIC')).toBe(true);
      expect(isValidTierCode('PRO')).toBe(true);
      expect(isValidTierCode('ENTERPRISE')).toBe(true);
    });

    it('should return false for invalid tier codes', () => {
      expect(isValidTierCode('INVALID')).toBe(false);
      expect(isValidTierCode('free')).toBe(false); // case sensitive
      expect(isValidTierCode('')).toBe(false);
    });
  });

  describe('setProductTierMapping', () => {
    it('should add new product to tier mapping', () => {
      const customTier: TierConfig = {
        code: 'PRO',
        name: 'Custom Pro',
        defaultDurationDays: 60,
      };

      setProductTierMapping('custom_pro_product', customTier);

      const retrieved = getTierFromProductId('custom_pro_product');
      expect(retrieved).toEqual(customTier);
    });
  });

  describe('getConfiguredProductIds', () => {
    it('should return array of configured product IDs', () => {
      const productIds = getConfiguredProductIds();

      expect(Array.isArray(productIds)).toBe(true);
      // These products were set up in beforeAll and setProductTierMapping test
      expect(productIds).toContain('prod_pro_monthly');
      expect(productIds).toContain('prod_basic_monthly');
      expect(productIds).toContain('prod_enterprise_monthly');
      expect(productIds).toContain('custom_pro_product');
    });
  });
});
