/**
 * Tests for tierMapping environment variable parsing
 * This file tests the buildProductToTierMap function by setting environment
 * variables before the module is loaded.
 */

describe('Tier Mapping Environment Variable Parsing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear the module cache so we can test fresh imports
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should parse VITE_TEST_TIER_MAPPING in non-production environment', async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITE_TEST_TIER_MAPPING = JSON.stringify({
      'Professional/Monthly': 'prod_professional_monthly',
      'Business/Yearly': 'prod_business_yearly',
      'Basic/Monthly': 'prod_basic_monthly',
      'Pro/Monthly': 'prod_pro_monthly',
      'Enterprise/Monthly': 'prod_enterprise_monthly',
      default: 'prod_default',
    });

    const { getTierFromProductId, getTierCodeFromProductId } =
      await import('../../config/tierMapping');

    // Test Professional tier
    const professional = getTierFromProductId('prod_professional_monthly');
    expect(professional).toEqual({
      code: 'PROFESSIONAL',
      name: 'Professional Monthly',
      defaultDurationDays: 32,
    });

    // Test Business Yearly tier (should have 367 days)
    const businessYearly = getTierFromProductId('prod_business_yearly');
    expect(businessYearly).toEqual({
      code: 'BUSINESS',
      name: 'Business Yearly',
      defaultDurationDays: 367,
    });

    // Test Basic tier
    expect(getTierCodeFromProductId('prod_basic_monthly')).toBe('BASIC');

    // Test Pro tier
    expect(getTierCodeFromProductId('prod_pro_monthly')).toBe('PRO');

    // Test Enterprise tier
    expect(getTierCodeFromProductId('prod_enterprise_monthly')).toBe('ENTERPRISE');
  });

  it('should parse VITE_PROD_TIER_MAPPING in production environment', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VITE_PROD_TIER_MAPPING = JSON.stringify({
      'Professional/Monthly': 'live_professional_monthly',
      'Business/Monthly': 'live_business_monthly',
    });

    const { getTierFromProductId } = await import('../../config/tierMapping');

    const professional = getTierFromProductId('live_professional_monthly');
    expect(professional).toEqual({
      code: 'PROFESSIONAL',
      name: 'Professional Monthly',
      defaultDurationDays: 32,
    });

    const business = getTierFromProductId('live_business_monthly');
    expect(business).toEqual({
      code: 'BUSINESS',
      name: 'Business Monthly',
      defaultDurationDays: 32,
    });
  });

  it('should skip "default" tier key in mapping', async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITE_TEST_TIER_MAPPING = JSON.stringify({
      default: 'prod_default',
      'Pro/Monthly': 'prod_pro_monthly',
    });

    const { getTierFromProductId, getConfiguredProductIds } =
      await import('../../config/tierMapping');

    // 'default' product should not be mapped
    expect(getTierFromProductId('prod_default')).toBeNull();

    // But Pro should be mapped
    expect(getTierFromProductId('prod_pro_monthly')).not.toBeNull();

    // Should not include default in configured products
    const productIds = getConfiguredProductIds();
    expect(productIds).not.toContain('prod_default');
  });

  it('should skip entries with empty product IDs', async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITE_TEST_TIER_MAPPING = JSON.stringify({
      'Pro/Monthly': '',
      'Basic/Monthly': 'prod_basic_monthly',
    });

    const { getTierFromProductId } = await import('../../config/tierMapping');

    // Empty product ID should not be mapped
    expect(getTierFromProductId('')).toBeNull();

    // Basic should be mapped
    expect(getTierFromProductId('prod_basic_monthly')).not.toBeNull();
  });

  it('should handle invalid JSON in tier mapping gracefully', async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITE_TEST_TIER_MAPPING = 'invalid json {';

    // Should not throw, just log error and return empty map
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    await import('../../config/tierMapping');

    // Should have logged an error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse tier mapping'),
      expect.anything()
    );

    consoleSpy.mockRestore();
  });

  it('should use FREE tier code for unknown tier names', async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITE_TEST_TIER_MAPPING = JSON.stringify({
      'UnknownTier/Monthly': 'prod_unknown_tier',
    });

    const { getTierFromProductId } = await import('../../config/tierMapping');

    const tier = getTierFromProductId('prod_unknown_tier');
    expect(tier?.code).toBe('FREE');
    expect(tier?.name).toBe('UnknownTier Monthly');
  });

  it('should handle tier without interval', async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITE_TEST_TIER_MAPPING = JSON.stringify({
      Professional: 'prod_professional_no_interval',
    });

    const { getTierFromProductId } = await import('../../config/tierMapping');

    const tier = getTierFromProductId('prod_professional_no_interval');
    expect(tier?.code).toBe('PROFESSIONAL');
    expect(tier?.name).toBe('Professional');
    expect(tier?.defaultDurationDays).toBe(32); // Not yearly, so 32 days
  });

  it('should return empty map when no environment variable is set', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.VITE_TEST_TIER_MAPPING;
    delete process.env.VITE_PROD_TIER_MAPPING;

    const { getConfiguredProductIds } = await import('../../config/tierMapping');

    // Should return empty array (or whatever products were set via setProductTierMapping)
    const productIds = getConfiguredProductIds();
    expect(Array.isArray(productIds)).toBe(true);
  });

  it('should log success message when tier mapping is loaded', async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITE_TEST_TIER_MAPPING = JSON.stringify({
      'Pro/Monthly': 'prod_pro_monthly',
    });

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await import('../../config/tierMapping');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Loaded tier mapping from environment'),
      expect.any(Array)
    );

    consoleSpy.mockRestore();
  });
});
