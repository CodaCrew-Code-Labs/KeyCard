export interface ProrationParams {
  currentPlanAmount: number;
  newPlanAmount: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  changeDate: Date;
}

export interface ProrationResult {
  creditAmount: number;
  chargeAmount: number;
  netAmount: number;
  unusedDays: number;
  totalDays: number;
}

/**
 * Calculate proration when changing subscription plans
 */
export function calculateProration(params: ProrationParams): ProrationResult {
  const { currentPlanAmount, newPlanAmount, currentPeriodStart, currentPeriodEnd, changeDate } =
    params;

  // Calculate total days in billing period
  const totalDays = Math.ceil(
    (currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Calculate unused days on current plan
  const unusedDays = Math.ceil(
    (currentPeriodEnd.getTime() - changeDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Calculate credit for unused time on current plan
  const creditAmount = (unusedDays / totalDays) * currentPlanAmount;

  // Calculate charge for remaining time on new plan
  const chargeAmount = (unusedDays / totalDays) * newPlanAmount;

  // Net amount to charge (can be negative if downgrading)
  const netAmount = chargeAmount - creditAmount;

  return {
    creditAmount: Math.round(creditAmount * 100) / 100,
    chargeAmount: Math.round(chargeAmount * 100) / 100,
    netAmount: Math.round(netAmount * 100) / 100,
    unusedDays,
    totalDays,
  };
}

/**
 * Generate invoice line items for proration
 */
export function generateProrationLineItems(
  proration: ProrationResult,
  currentPlanName: string,
  newPlanName: string
): Array<{
  description: string;
  quantity: number;
  unit_amount: number;
  amount: number;
  proration: boolean;
}> {
  const items = [];

  // Add credit line item if there's unused time
  if (proration.creditAmount > 0) {
    items.push({
      description: `Credit for unused time on ${currentPlanName} (${proration.unusedDays}/${proration.totalDays} days)`,
      quantity: 1,
      unit_amount: -proration.creditAmount,
      amount: -proration.creditAmount,
      proration: true,
    });
  }

  // Add charge line item for new plan
  if (proration.chargeAmount > 0) {
    items.push({
      description: `Charge for ${newPlanName} (${proration.unusedDays}/${proration.totalDays} days)`,
      quantity: 1,
      unit_amount: proration.chargeAmount,
      amount: proration.chargeAmount,
      proration: true,
    });
  }

  return items;
}

/**
 * Calculate next billing date based on interval
 */
export function calculateNextBillingDate(
  currentDate: Date,
  interval: 'day' | 'week' | 'month' | 'year',
  intervalCount: number = 1
): Date {
  const nextDate = new Date(currentDate);

  switch (interval) {
    case 'day':
      nextDate.setDate(nextDate.getDate() + intervalCount);
      break;
    case 'week':
      nextDate.setDate(nextDate.getDate() + 7 * intervalCount);
      break;
    case 'month':
      nextDate.setMonth(nextDate.getMonth() + intervalCount);
      break;
    case 'year':
      nextDate.setFullYear(nextDate.getFullYear() + intervalCount);
      break;
  }

  return nextDate;
}

/**
 * Generate unique invoice number
 */
export function generateInvoiceNumber(prefix: string = 'INV'): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${year}${month}-${timestamp}${random}`;
}
