import {
  getTierLevel,
  isUpgrade,
  isDowngrade,
  isSameTierLevel,
  normalizeBillingFrequency,
  isBillingFrequencyChange,
  determineChangeType,
  getChangeTypeDescription,
  SubscriptionChangeType,
} from '../../utils/tierComparison';

describe('tierComparison utilities', () => {
  describe('getTierLevel', () => {
    it('should return 0 for FREE tier', () => {
      expect(getTierLevel('FREE')).toBe(0);
      expect(getTierLevel('free')).toBe(0);
      expect(getTierLevel('Free')).toBe(0);
    });

    it('should return 1 for BASIC tier', () => {
      expect(getTierLevel('BASIC')).toBe(1);
      expect(getTierLevel('basic')).toBe(1);
    });

    it('should return 2 for PROFESSIONAL/PRO tier', () => {
      expect(getTierLevel('PROFESSIONAL')).toBe(2);
      expect(getTierLevel('PRO')).toBe(2);
      expect(getTierLevel('pro')).toBe(2);
    });

    it('should return 3 for BUSINESS tier', () => {
      expect(getTierLevel('BUSINESS')).toBe(3);
      expect(getTierLevel('business')).toBe(3);
    });

    it('should return 3 for ENTERPRISE tier (same level as BUSINESS)', () => {
      expect(getTierLevel('ENTERPRISE')).toBe(3);
      expect(getTierLevel('enterprise')).toBe(3);
    });

    it('should return 0 for unknown tiers', () => {
      expect(getTierLevel('UNKNOWN')).toBe(0);
      expect(getTierLevel('PREMIUM')).toBe(0);
      expect(getTierLevel('')).toBe(0);
    });
  });

  describe('isUpgrade', () => {
    it('should return true when moving to a higher tier', () => {
      expect(isUpgrade('FREE', 'BASIC')).toBe(true);
      expect(isUpgrade('FREE', 'PRO')).toBe(true);
      expect(isUpgrade('FREE', 'BUSINESS')).toBe(true);
      expect(isUpgrade('BASIC', 'PROFESSIONAL')).toBe(true);
      expect(isUpgrade('BASIC', 'ENTERPRISE')).toBe(true);
      expect(isUpgrade('PRO', 'BUSINESS')).toBe(true);
    });

    it('should return false when moving to the same tier level', () => {
      expect(isUpgrade('FREE', 'FREE')).toBe(false);
      expect(isUpgrade('PRO', 'PROFESSIONAL')).toBe(false);
      expect(isUpgrade('BUSINESS', 'ENTERPRISE')).toBe(false);
    });

    it('should return false when downgrading', () => {
      expect(isUpgrade('BUSINESS', 'PRO')).toBe(false);
      expect(isUpgrade('PRO', 'BASIC')).toBe(false);
      expect(isUpgrade('BASIC', 'FREE')).toBe(false);
    });

    it('should handle case-insensitive comparisons', () => {
      expect(isUpgrade('free', 'BASIC')).toBe(true);
      expect(isUpgrade('FREE', 'basic')).toBe(true);
    });
  });

  describe('isDowngrade', () => {
    it('should return true when moving to a lower tier', () => {
      expect(isDowngrade('BASIC', 'FREE')).toBe(true);
      expect(isDowngrade('PRO', 'BASIC')).toBe(true);
      expect(isDowngrade('BUSINESS', 'FREE')).toBe(true);
      expect(isDowngrade('ENTERPRISE', 'PRO')).toBe(true);
    });

    it('should return false when moving to the same tier level', () => {
      expect(isDowngrade('FREE', 'FREE')).toBe(false);
      expect(isDowngrade('PRO', 'PROFESSIONAL')).toBe(false);
      expect(isDowngrade('BUSINESS', 'ENTERPRISE')).toBe(false);
    });

    it('should return false when upgrading', () => {
      expect(isDowngrade('FREE', 'BASIC')).toBe(false);
      expect(isDowngrade('BASIC', 'PRO')).toBe(false);
    });

    it('should handle case-insensitive comparisons', () => {
      expect(isDowngrade('BUSINESS', 'free')).toBe(true);
      expect(isDowngrade('business', 'FREE')).toBe(true);
    });
  });

  describe('isSameTierLevel', () => {
    it('should return true for same tier', () => {
      expect(isSameTierLevel('FREE', 'FREE')).toBe(true);
      expect(isSameTierLevel('BASIC', 'BASIC')).toBe(true);
      expect(isSameTierLevel('PRO', 'PRO')).toBe(true);
    });

    it('should return true for tiers at same level', () => {
      expect(isSameTierLevel('PRO', 'PROFESSIONAL')).toBe(true);
      expect(isSameTierLevel('BUSINESS', 'ENTERPRISE')).toBe(true);
      expect(isSameTierLevel('ENTERPRISE', 'BUSINESS')).toBe(true);
    });

    it('should return false for different tier levels', () => {
      expect(isSameTierLevel('FREE', 'BASIC')).toBe(false);
      expect(isSameTierLevel('BASIC', 'PRO')).toBe(false);
      expect(isSameTierLevel('PRO', 'BUSINESS')).toBe(false);
    });

    it('should handle case-insensitive comparisons', () => {
      expect(isSameTierLevel('pro', 'PROFESSIONAL')).toBe(true);
      expect(isSameTierLevel('business', 'ENTERPRISE')).toBe(true);
    });
  });

  describe('normalizeBillingFrequency', () => {
    it('should normalize MONTH/MONTHLY to MONTHLY', () => {
      expect(normalizeBillingFrequency('MONTH')).toBe('MONTHLY');
      expect(normalizeBillingFrequency('Month')).toBe('MONTHLY');
      expect(normalizeBillingFrequency('month')).toBe('MONTHLY');
      expect(normalizeBillingFrequency('MONTHLY')).toBe('MONTHLY');
      expect(normalizeBillingFrequency('monthly')).toBe('MONTHLY');
    });

    it('should normalize YEAR/YEARLY to YEARLY', () => {
      expect(normalizeBillingFrequency('YEAR')).toBe('YEARLY');
      expect(normalizeBillingFrequency('Year')).toBe('YEARLY');
      expect(normalizeBillingFrequency('year')).toBe('YEARLY');
      expect(normalizeBillingFrequency('YEARLY')).toBe('YEARLY');
      expect(normalizeBillingFrequency('yearly')).toBe('YEARLY');
    });

    it('should return null for null input', () => {
      expect(normalizeBillingFrequency(null)).toBeNull();
    });

    it('should return unrecognized values as uppercase', () => {
      expect(normalizeBillingFrequency('QUARTERLY')).toBe('QUARTERLY');
      expect(normalizeBillingFrequency('weekly')).toBe('WEEKLY');
    });
  });

  describe('isBillingFrequencyChange', () => {
    it('should return true when frequency changes', () => {
      expect(isBillingFrequencyChange('MONTHLY', 'YEARLY')).toBe(true);
      expect(isBillingFrequencyChange('YEARLY', 'MONTHLY')).toBe(true);
      expect(isBillingFrequencyChange('Month', 'Year')).toBe(true);
    });

    it('should return false when frequency stays the same', () => {
      expect(isBillingFrequencyChange('MONTHLY', 'MONTHLY')).toBe(false);
      expect(isBillingFrequencyChange('YEARLY', 'YEARLY')).toBe(false);
      expect(isBillingFrequencyChange('Month', 'MONTHLY')).toBe(false);
      expect(isBillingFrequencyChange('Year', 'YEARLY')).toBe(false);
    });

    it('should return false when either value is null', () => {
      expect(isBillingFrequencyChange(null, 'MONTHLY')).toBe(false);
      expect(isBillingFrequencyChange('MONTHLY', null)).toBe(false);
      expect(isBillingFrequencyChange(null, null)).toBe(false);
    });
  });

  describe('determineChangeType', () => {
    describe('upgrades', () => {
      it('should return IMMEDIATE_UPGRADE when tier increases', () => {
        expect(determineChangeType('FREE', 'BASIC', 'MONTHLY', 'MONTHLY')).toBe(
          'IMMEDIATE_UPGRADE'
        );
        expect(determineChangeType('BASIC', 'PRO', 'YEARLY', 'YEARLY')).toBe('IMMEDIATE_UPGRADE');
        expect(determineChangeType('PRO', 'BUSINESS', null, null)).toBe('IMMEDIATE_UPGRADE');
      });

      it('should return IMMEDIATE_UPGRADE when current tier is null (treated as FREE)', () => {
        expect(determineChangeType(null, 'BASIC', null, 'MONTHLY')).toBe('IMMEDIATE_UPGRADE');
        expect(determineChangeType(null, 'PRO', null, 'YEARLY')).toBe('IMMEDIATE_UPGRADE');
      });
    });

    describe('downgrades', () => {
      it('should return DEFERRED_DOWNGRADE when tier decreases', () => {
        expect(determineChangeType('PRO', 'BASIC', 'MONTHLY', 'MONTHLY')).toBe(
          'DEFERRED_DOWNGRADE'
        );
        expect(determineChangeType('BUSINESS', 'FREE', 'YEARLY', 'MONTHLY')).toBe(
          'DEFERRED_DOWNGRADE'
        );
        expect(determineChangeType('ENTERPRISE', 'PRO', null, null)).toBe('DEFERRED_DOWNGRADE');
      });
    });

    describe('frequency changes', () => {
      it('should return DEFERRED_FREQUENCY_CHANGE when only frequency changes', () => {
        expect(determineChangeType('PRO', 'PRO', 'MONTHLY', 'YEARLY')).toBe(
          'DEFERRED_FREQUENCY_CHANGE'
        );
        expect(determineChangeType('BASIC', 'BASIC', 'YEARLY', 'MONTHLY')).toBe(
          'DEFERRED_FREQUENCY_CHANGE'
        );
      });

      it('should return DEFERRED_FREQUENCY_CHANGE for same-level tier with frequency change', () => {
        expect(determineChangeType('PRO', 'PROFESSIONAL', 'MONTHLY', 'YEARLY')).toBe(
          'DEFERRED_FREQUENCY_CHANGE'
        );
        expect(determineChangeType('BUSINESS', 'ENTERPRISE', 'YEARLY', 'MONTHLY')).toBe(
          'DEFERRED_FREQUENCY_CHANGE'
        );
      });
    });

    describe('no change', () => {
      it('should return NO_CHANGE when nothing changes', () => {
        expect(determineChangeType('PRO', 'PRO', 'MONTHLY', 'MONTHLY')).toBe('NO_CHANGE');
        expect(determineChangeType('BASIC', 'BASIC', 'YEARLY', 'YEARLY')).toBe('NO_CHANGE');
      });

      it('should return NO_CHANGE for same-level tiers with same frequency', () => {
        expect(determineChangeType('PRO', 'PROFESSIONAL', 'MONTHLY', 'MONTHLY')).toBe('NO_CHANGE');
        expect(determineChangeType('BUSINESS', 'ENTERPRISE', 'YEARLY', 'YEARLY')).toBe('NO_CHANGE');
      });

      it('should return NO_CHANGE when both frequencies are null', () => {
        expect(determineChangeType('PRO', 'PRO', null, null)).toBe('NO_CHANGE');
      });
    });
  });

  describe('getChangeTypeDescription', () => {
    it('should return correct description for IMMEDIATE_UPGRADE', () => {
      expect(getChangeTypeDescription('IMMEDIATE_UPGRADE')).toBe(
        'Upgrade (applies immediately with prorated billing)'
      );
    });

    it('should return correct description for DEFERRED_DOWNGRADE', () => {
      expect(getChangeTypeDescription('DEFERRED_DOWNGRADE')).toBe(
        'Downgrade (applies at end of current billing cycle)'
      );
    });

    it('should return correct description for DEFERRED_FREQUENCY_CHANGE', () => {
      expect(getChangeTypeDescription('DEFERRED_FREQUENCY_CHANGE')).toBe(
        'Billing frequency change (applies at end of current billing cycle)'
      );
    });

    it('should return correct description for NO_CHANGE', () => {
      expect(getChangeTypeDescription('NO_CHANGE')).toBe('No change');
    });

    it('should handle all SubscriptionChangeType values', () => {
      const changeTypes: SubscriptionChangeType[] = [
        'IMMEDIATE_UPGRADE',
        'DEFERRED_DOWNGRADE',
        'DEFERRED_FREQUENCY_CHANGE',
        'NO_CHANGE',
      ];

      changeTypes.forEach((type) => {
        expect(typeof getChangeTypeDescription(type)).toBe('string');
        expect(getChangeTypeDescription(type).length).toBeGreaterThan(0);
      });
    });
  });
});
