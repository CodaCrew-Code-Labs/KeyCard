import { calculateProration, generateProrationLineItems, calculateNextBillingDate, generateInvoiceNumber } from '../proration';

describe('Proration Utilities', () => {
  describe('calculateProration', () => {
    it('should calculate proration for plan upgrade', () => {
      const changeDate = new Date('2025-01-15');
      const periodStart = new Date('2025-01-01');
      const periodEnd = new Date('2025-02-01');

      const result = calculateProration({
        currentPlanAmount: 50,
        newPlanAmount: 100,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        changeDate,
      });

      expect(result.unusedDays).toBeGreaterThan(0);
      expect(result.netAmount).toBeGreaterThan(0); // Upgrade costs more
    });

    it('should calculate proration for plan downgrade', () => {
      const changeDate = new Date('2025-01-15');
      const periodStart = new Date('2025-01-01');
      const periodEnd = new Date('2025-02-01');

      const result = calculateProration({
        currentPlanAmount: 100,
        newPlanAmount: 50,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        changeDate,
      });

      expect(result.netAmount).toBeLessThan(0); // Downgrade gives credit
    });
  });

  describe('generateProrationLineItems', () => {
    it('should generate line items with credit and charge', () => {
      const proration = {
        creditAmount: 25,
        chargeAmount: 50,
        netAmount: 25,
        unusedDays: 15,
        totalDays: 30,
      };

      const items = generateProrationLineItems(proration, 'Basic Plan', 'Pro Plan');

      expect(items).toHaveLength(2);
      expect(items[0].amount).toBe(-25); // Credit
      expect(items[1].amount).toBe(50); // Charge
      expect(items[0].proration).toBe(true);
      expect(items[1].proration).toBe(true);
    });
  });

  describe('calculateNextBillingDate', () => {
    it('should calculate next billing date for monthly interval', () => {
      const currentDate = new Date('2025-01-01');
      const next = calculateNextBillingDate(currentDate, 'month', 1);

      expect(next.getMonth()).toBe(1); // February
    });

    it('should calculate next billing date for yearly interval', () => {
      const currentDate = new Date('2025-01-01');
      const next = calculateNextBillingDate(currentDate, 'year', 1);

      expect(next.getFullYear()).toBe(2026);
    });

    it('should calculate next billing date for weekly interval', () => {
      const currentDate = new Date('2025-01-01');
      const next = calculateNextBillingDate(currentDate, 'week', 1);

      expect(next.getDate()).toBe(8);
    });
  });

  describe('generateInvoiceNumber', () => {
    it('should generate unique invoice numbers', () => {
      const inv1 = generateInvoiceNumber();
      const inv2 = generateInvoiceNumber();

      expect(inv1).toMatch(/^INV-\d{6}-\d{6}$/);
      expect(inv1).not.toBe(inv2);
    });

    it('should use custom prefix', () => {
      const inv = generateInvoiceNumber('CUSTOM');

      expect(inv).toMatch(/^CUSTOM-\d{6}-\d{6}$/);
    });
  });
});
