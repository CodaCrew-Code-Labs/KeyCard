import DodoPayments from 'dodopayments';

class DodoPaymentsService {
  private static instance: DodoPayments | null = null;

  static initialize(
    apiKey: string,
    environment: 'test_mode' | 'live_mode' = 'test_mode',
    webhookKey?: string
  ): DodoPayments {
    if (!this.instance) {
      this.instance = new DodoPayments({
        bearerToken: apiKey,
        environment:
          (process.env.DODO_PAYMENTS_ENVIRONMENT as 'test_mode' | 'live_mode') || environment,
        webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY || webhookKey,
      });
    }
    return this.instance;
  }

  static getClient(): DodoPayments {
    if (!this.instance) {
      throw new Error('DodoPayments client not initialized. Call initialize() first.');
    }
    return this.instance;
  }
}

export { DodoPaymentsService };
