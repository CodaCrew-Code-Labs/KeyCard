import { PaymentAdapter } from '../types';
import { DodoPaymentsAdapter, DodoPaymentsConfig } from './dodoPayments';

export { DodoPaymentsAdapter };

/**
 * Create payment adapter from configuration
 */
export function createPaymentAdapter(
  provider: string,
  config: any,
  customProcessor?: PaymentAdapter
): PaymentAdapter {
  // If custom processor provided, use it
  if (customProcessor) {
    return customProcessor;
  }

  // Otherwise, create built-in adapter
  switch (provider.toLowerCase()) {
    case 'dodo_payments':
      return new DodoPaymentsAdapter(config as DodoPaymentsConfig);
    default:
      throw new Error(`Unknown payment provider: ${provider}`);
  }
}
