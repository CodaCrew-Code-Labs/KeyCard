/**
 * Tier Mapping Configuration
 *
 * Maps DoDo product IDs to your application tier codes.
 * Reads from environment variables VITE_TEST_TIER_MAPPING or VITE_PROD_TIER_MAPPING.
 */

export type TierCode = 'FREE' | 'PROFESSIONAL' | 'BUSINESS' | 'BASIC' | 'PRO' | 'ENTERPRISE';

export interface TierConfig {
  code: TierCode;
  name: string;
  /** Default duration in days for this tier (used when webhook doesn't provide period_end) */
  defaultDurationDays: number;
}

/**
 * Parse tier mapping from environment variable
 * Format: {"tierName/interval":"productId", ...}
 * We need to reverse it to: productId -> tierCode
 */
function buildProductToTierMap(): Record<string, TierConfig> {
  const map: Record<string, TierConfig> = {};

  // Get the appropriate mapping based on environment
  const envMapping =
    process.env.NODE_ENV === 'production'
      ? process.env.VITE_PROD_TIER_MAPPING
      : process.env.VITE_TEST_TIER_MAPPING;

  if (envMapping) {
    try {
      const parsed = JSON.parse(envMapping) as Record<string, string>;

      for (const [tierKey, productId] of Object.entries(parsed)) {
        if (tierKey === 'default' || !productId) continue;

        // Parse tier key like "Professional/Monthly" or "Business/Yearly"
        const [tierName, interval] = tierKey.split('/');
        const isYearly = interval?.toLowerCase() === 'yearly';

        // Map tier names to tier codes
        let tierCode: TierCode;
        switch (tierName.toLowerCase()) {
          case 'professional':
            tierCode = 'PROFESSIONAL';
            break;
          case 'business':
            tierCode = 'BUSINESS';
            break;
          case 'basic':
            tierCode = 'BASIC';
            break;
          case 'pro':
            tierCode = 'PRO';
            break;
          case 'enterprise':
            tierCode = 'ENTERPRISE';
            break;
          default:
            tierCode = 'FREE';
        }

        map[productId] = {
          code: tierCode,
          name: `${tierName} ${interval || ''}`.trim(),
          defaultDurationDays: isYearly ? 367 : 32,
        };
      }

      console.log('✅ Loaded tier mapping from environment:', Object.keys(map));
    } catch (error) {
      console.error('❌ Failed to parse tier mapping from environment:', error);
    }
  }

  return map;
}

/**
 * Map of DoDo product IDs to tier configurations.
 * Populated from environment variables.
 */
const productToTierMap: Record<string, TierConfig> = buildProductToTierMap();

/**
 * Get active length (Monthly/Yearly) from a DoDo product ID
 */
export function getActiveLengthFromProductId(productId: string): 'MONTHLY' | 'YEARLY' | null {
  const envMapping =
    process.env.NODE_ENV === 'production'
      ? process.env.VITE_PROD_TIER_MAPPING
      : process.env.VITE_TEST_TIER_MAPPING;

  if (envMapping) {
    try {
      const parsed = JSON.parse(envMapping) as Record<string, string>;

      for (const [tierKey, mappedProductId] of Object.entries(parsed)) {
        if (mappedProductId === productId && tierKey !== 'default') {
          const [, interval] = tierKey.split('/');
          if (interval?.toLowerCase() === 'yearly') return 'YEARLY';
          if (interval?.toLowerCase() === 'monthly') return 'MONTHLY';
        }
      }
    } catch (error) {
      console.error('❌ Failed to parse tier mapping for active length:', error);
    }
  }

  return null;
}

/**
 * Get tier configuration from a DoDo product ID
 */
export function getTierFromProductId(productId: string): TierConfig | null {
  return productToTierMap[productId] || null;
}

/**
 * Get tier code from a DoDo product ID
 */
export function getTierCodeFromProductId(productId: string): TierCode | null {
  const config = productToTierMap[productId];
  return config ? config.code : null;
}

/**
 * Get tier from a product cart (uses first product in cart)
 */
export function getTierFromProductCart(
  productCart: Array<{ product_id: string; quantity: number }>
): TierConfig | null {
  if (!productCart || productCart.length === 0) {
    return null;
  }
  return getTierFromProductId(productCart[0].product_id);
}

/**
 * Calculate tier expiration date
 */
export function calculateTierExpiration(
  tier: TierConfig,
  currentPeriodEnd?: Date | string | null
): Date {
  if (currentPeriodEnd) {
    return new Date(currentPeriodEnd);
  }
  // Default: add tier's default duration
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + tier.defaultDurationDays);
  return expiresAt;
}

/**
 * Check if a tier code is valid
 */
export function isValidTierCode(tier: string): tier is TierCode {
  return ['FREE', 'PROFESSIONAL', 'BUSINESS', 'BASIC', 'PRO', 'ENTERPRISE'].includes(tier);
}

/**
 * Get tier configuration by tier code (reverse lookup)
 * Returns the first matching tier config, or a default config if not found
 */
export function getTierConfigByCode(
  tierCode: string,
  activeLength?: string | null
): TierConfig | null {
  const isYearly = activeLength?.toUpperCase() === 'YEARLY';

  // Find a matching tier config from the product map
  for (const config of Object.values(productToTierMap)) {
    if (config.code === tierCode) {
      // If we have an activeLength, try to match the duration
      if (activeLength) {
        const configIsYearly = config.defaultDurationDays > 100;
        if (configIsYearly === isYearly) {
          return config;
        }
      } else {
        return config;
      }
    }
  }

  // If no exact match found, return a default config for the tier
  if (isValidTierCode(tierCode)) {
    return {
      code: tierCode as TierCode,
      name: tierCode,
      defaultDurationDays: isYearly ? 367 : 32,
    };
  }

  return null;
}

/**
 * Add or update a product to tier mapping at runtime
 * (useful for dynamic configuration)
 */
export function setProductTierMapping(productId: string, config: TierConfig): void {
  productToTierMap[productId] = config;
}

/**
 * Get all configured product IDs
 */
export function getConfiguredProductIds(): string[] {
  return Object.keys(productToTierMap);
}

export { productToTierMap };
