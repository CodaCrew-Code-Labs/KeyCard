import { Request, Application } from 'express';
import { PrismaClient } from '@prisma/client';
import { Server } from 'http';

// Configuration types
export interface DatabaseConfig {
  url?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  poolSize?: number;
  timeout?: number;
  prismaClient?: PrismaClient;
}

export interface AuthConfig {
  validateRequest: (req: Request) => Promise<AuthValidationResult>;
}

export interface FeaturesConfig {
  autoMigration?: boolean;
  webhooks?: boolean;
}

export interface CorsConfig {
  origin: string | string[];
  credentials?: boolean;
}

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface PaymentConfig {
  provider: 'dodo_payments';
  config: {
    apiKey: string;
    environment?: 'test_mode' | 'live_mode';
    webhookKey?: string;
  };
}

export interface SubscriptionBackendConfig {
  port: number;
  database: DatabaseConfig;
  auth: AuthConfig;
  payment?: PaymentConfig;
  features?: FeaturesConfig;
  cors?: CorsConfig;
  rateLimit?: RateLimitConfig;
  logger?: Logger;
}

// Auth types
export interface AuthValidationResult {
  userId: string;
  tenantId: string;
  isValid: boolean;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthValidationResult;
}

// Logger interface
export interface Logger {
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  debug(message: string, meta?: unknown): void;
}

// Subscription Backend Instance
export interface SubscriptionBackend {
  app: Application;
  server: Server | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

// DodoPayments API types
export interface CheckoutSessionData {
  product_cart: Array<{
    product_id: string;
    quantity: number;
  }>;
  return_url?: string;
  customer?: {
    customer_id?: string;
    email?: string;
  };
  metadata?: Record<string, string>;
}

export interface CheckoutResponse {
  session_id: string;
  checkout_url: string;
  status?: string;
}

// Webhook types
export interface WebhookData {
  event_type: string;
  data: Record<string, unknown>;
}

export interface WebhookCustomer {
  customer_id?: string;
  email?: string;
  name?: string;
}

export interface WebhookProduct {
  product_id: string;
  quantity: number;
}

export interface CustomerData {
  customer_id?: string;
  email?: string;
}

export interface PaymentData {
  payment_id: string;
  business_id?: string;
  customer?: WebhookCustomer;
  metadata?: Record<string, string>;
  total_amount?: number;
  currency?: string;
  status?: string;
  payment_method?: string;
  payment_method_type?: string;
  product_cart?: WebhookProduct[];
  subscription_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SubscriptionData {
  subscription_id: string;
  business_id?: string;
  customer?: WebhookCustomer;
  metadata?: Record<string, string>;
  status?: string;
  billing?: {
    city?: string;
    country?: string;
    state?: string;
    street?: string;
    zipcode?: string;
  };
  // DoDo uses these field names for subscription periods
  expires_at?: string;
  next_billing_date?: string;
  previous_billing_date?: string;
  // Legacy field names (keep for backwards compatibility)
  current_period_start?: string;
  current_period_end?: string;
  product_id?: string;
  quantity?: number;
  currency?: string;
  recurring_pre_tax_amount?: number;
  payment_frequency_count?: number;
  payment_frequency_interval?: string;
  subscription_period_count?: number;
  subscription_period_interval?: string;
  cancel_at_next_billing_date?: boolean;
  created_at?: string;
  cancelled_at?: string;
  trial_period_days?: number;
  on_demand?: boolean;
  payment_method_id?: string;
  tax_inclusive?: boolean;
  addons?: unknown[];
  meters?: unknown[];
}

// Billing response types
export interface BillingResponse {
  activeTier: string | null;
  tierExpiresAt: string | null;
  latestPayment: {
    status: string;
    paidAt: string | null;
    amountCents: number | null;
    currency: string | null;
    tier: string | null;
    dodoPaymentId: string;
    createdAt: string;
  } | null;
}

// Extended checkout response with payment/subscription info
export interface ExtendedCheckoutResponse {
  session_id: string;
  checkout_url: string;
  status?: string;
  payment_id?: string;
  subscription_id?: string;
  customer?: WebhookCustomer;
  metadata?: Record<string, string>;
  product_cart?: WebhookProduct[];
}

// API Error types
export class SubscriptionError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SubscriptionError';
  }
}
