import crypto from 'crypto';
import {
  PaymentAdapter,
  CreatePaymentParams,
  CreatePaymentResult,
  RefundPaymentParams,
  RefundPaymentResult,
  VerifyWebhookParams,
  ProcessWebhookResult,
} from '../types';

export interface DodoPaymentsConfig {
  apiKey: string;
  apiSecret: string;
  merchantId: string;
  baseUrl?: string;
}

export class DodoPaymentsAdapter implements PaymentAdapter {
  name = 'dodo_payments';
  private config: DodoPaymentsConfig;

  constructor(config: DodoPaymentsConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl || 'https://api.dodopayments.com',
    };
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    try {
      const response = await this.makeRequest('/v1/charges', {
        method: 'POST',
        body: {
          amount: Math.round(params.amount * 100),
          currency: params.currency,
          customer_id: params.customerId,
          merchant_id: this.config.merchantId,
          metadata: params.metadata,
        },
      });

      return {
        paymentId: (response.id as string) || `dodo_${Date.now()}`,
        status: this.mapStatus((response.status as string) || 'success'),
        providerResponse: response,
      };
    } catch (error) {
      return {
        paymentId: `failed_${Date.now()}`,
        status: 'failed',
        providerResponse: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    try {
      const response = await this.makeRequest(`/v1/charges/${params.paymentId}/refund`, {
        method: 'POST',
        body: {
          amount: params.amount ? Math.round(params.amount * 100) : undefined,
          reason: params.reason,
        },
      });

      return {
        refundId: (response.id as string) || `refund_${Date.now()}`,
        status: response.status === 'success' ? 'succeeded' : 'failed',
      };
    } catch (error) {
      return {
        refundId: `failed_${Date.now()}`,
        status: 'failed',
      };
    }
  }

  verifyWebhook(params: VerifyWebhookParams): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', params.secret)
        .update(params.payload)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(params.signature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  }

  async processWebhook(payload: Record<string, unknown>): Promise<ProcessWebhookResult> {
    const data = payload.data as Record<string, unknown> | undefined;
    return {
      eventType: (payload.event_type as string) || 'payment.unknown',
      paymentId: (data?.charge_id as string) || (data?.id as string) || '',
      status: this.mapStatus(data?.status as string),
      metadata: data,
    };
  }

  private mapStatus(dodoStatus: string): 'pending' | 'succeeded' | 'failed' {
    const statusMap: Record<string, 'pending' | 'succeeded' | 'failed'> = {
      success: 'succeeded',
      completed: 'succeeded',
      failure: 'failed',
      failed: 'failed',
      processing: 'pending',
      pending: 'pending',
    };

    return statusMap[dodoStatus?.toLowerCase()] || 'pending';
  }

  private async makeRequest(
    endpoint: string,
    options: { method: string; body?: Record<string, unknown> }
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.baseUrl}${endpoint}`;

    if (process.env.NODE_ENV === 'test' || process.env.MOCK_PAYMENTS === 'true') {
      return {
        id: `dodo_mock_${Date.now()}`,
        status: 'success',
        ...options.body,
      };
    }

    const response = await fetch(url, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        'X-Merchant-ID': this.config.merchantId,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`DoDo Payments API error: ${response.statusText}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}
