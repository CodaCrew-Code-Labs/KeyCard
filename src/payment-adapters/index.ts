import { PaymentAdapter } from '../types';
import { DodoPaymentsAdapter, DodoPaymentsConfig } from './dodoPayments';

export { DodoPaymentsAdapter };

export function createPaymentAdapter(
  provider: string,
  config: Record<string, unknown>,
  customProcessor?: PaymentAdapter
): PaymentAdapter {
  if (customProcessor) {
    return customProcessor;
  }

  switch (provider.toLowerCase()) {
    case 'dodo_payments':
      return new DodoPaymentsAdapter(config as unknown as DodoPaymentsConfig);
    default:
      throw new Error(`Unknown payment provider: ${provider}`);
  }
}
