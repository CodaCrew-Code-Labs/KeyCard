/**
 * Tier Comparison Utilities
 *
 * Utilities for comparing subscription tiers and determining
 * whether a plan change is an upgrade, downgrade, or frequency change.
 */

/**
 * Tier hierarchy - higher number means higher tier
 * ENTERPRISE and BUSINESS are at the same level (3)
 */
const TIER_HIERARCHY: Record<string, number> = {
  FREE: 0,
  BASIC: 1,
  PROFESSIONAL: 2,
  PRO: 2,
  BUSINESS: 3,
  ENTERPRISE: 3,
};

/**
 * Get the hierarchy level of a tier
 */
export function getTierLevel(tier: string): number {
  return TIER_HIERARCHY[tier.toUpperCase()] ?? 0;
}

/**
 * Check if changing from currentTier to newTier is an upgrade
 */
export function isUpgrade(currentTier: string, newTier: string): boolean {
  return getTierLevel(newTier) > getTierLevel(currentTier);
}

/**
 * Check if changing from currentTier to newTier is a downgrade
 */
export function isDowngrade(currentTier: string, newTier: string): boolean {
  return getTierLevel(newTier) < getTierLevel(currentTier);
}

/**
 * Check if the tier level remains the same (lateral move)
 */
export function isSameTierLevel(currentTier: string, newTier: string): boolean {
  return getTierLevel(newTier) === getTierLevel(currentTier);
}

/**
 * Normalize billing frequency to standard format (MONTHLY/YEARLY)
 * Handles DoDo's format ("Month", "Year") and our internal format ("MONTHLY", "YEARLY")
 */
export function normalizeBillingFrequency(frequency: string | null): string | null {
  if (!frequency) return null;
  const upper = frequency.toUpperCase();
  if (upper === 'MONTH' || upper === 'MONTHLY') return 'MONTHLY';
  if (upper === 'YEAR' || upper === 'YEARLY') return 'YEARLY';
  return upper; // Return as-is if not recognized
}

/**
 * Check if billing frequency is changing
 */
export function isBillingFrequencyChange(
  currentLength: string | null,
  newLength: string | null
): boolean {
  if (!currentLength || !newLength) return false;
  // Normalize both values before comparison
  const normalizedCurrent = normalizeBillingFrequency(currentLength);
  const normalizedNew = normalizeBillingFrequency(newLength);
  return normalizedCurrent !== normalizedNew;
}

/**
 * Types of subscription changes
 */
export type SubscriptionChangeType =
  | 'IMMEDIATE_UPGRADE' // Higher tier - apply immediately with proration
  | 'DEFERRED_DOWNGRADE' // Lower tier - apply at end of billing cycle
  | 'DEFERRED_FREQUENCY_CHANGE' // Same tier, different billing frequency - apply at end of cycle
  | 'NO_CHANGE'; // No actual change

/**
 * Determine the type of subscription change
 *
 * Business rules:
 * - Upgrades: Apply immediately (user gets immediate access, prorated billing)
 * - Downgrades: Deferred to end of billing cycle (user keeps current tier until period ends)
 * - Frequency changes: Deferred to end of billing cycle
 */
export function determineChangeType(
  currentTier: string | null,
  newTier: string,
  currentLength: string | null,
  newLength: string | null
): SubscriptionChangeType {
  const effectiveCurrentTier = currentTier || 'FREE';

  // Check for tier level changes first
  if (isUpgrade(effectiveCurrentTier, newTier)) {
    return 'IMMEDIATE_UPGRADE';
  }

  if (isDowngrade(effectiveCurrentTier, newTier)) {
    return 'DEFERRED_DOWNGRADE';
  }

  // Same tier level - check for frequency change
  if (isBillingFrequencyChange(currentLength, newLength)) {
    return 'DEFERRED_FREQUENCY_CHANGE';
  }

  return 'NO_CHANGE';
}

/**
 * Get a human-readable description of the change type
 */
export function getChangeTypeDescription(changeType: SubscriptionChangeType): string {
  switch (changeType) {
    case 'IMMEDIATE_UPGRADE':
      return 'Upgrade (applies immediately with prorated billing)';
    case 'DEFERRED_DOWNGRADE':
      return 'Downgrade (applies at end of current billing cycle)';
    case 'DEFERRED_FREQUENCY_CHANGE':
      return 'Billing frequency change (applies at end of current billing cycle)';
    case 'NO_CHANGE':
      return 'No change';
  }
}
