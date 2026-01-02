import { Request } from 'express';
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

export interface PaymentConfig {
  provider: string;
  config: Record<string, any>;
  customProcessor?: PaymentAdapter;
}

export interface AuthConfig {
  validateRequest: (req: Request) => Promise<AuthValidationResult>;
}

export interface DunningConfig {
  enabled: boolean;
  retrySchedule: number[];
  emailProvider?: string;
  emailConfig?: Record<string, any>;
}

export interface FeaturesConfig {
  autoMigration?: boolean;
  webhooks?: boolean;
  analytics?: boolean;
  dunning?: DunningConfig;
}

export interface CorsConfig {
  origin: string | string[];
  credentials?: boolean;
}

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface LifecycleHooks {
  onSubscriptionCreated?: (subscription: any) => Promise<void>;
  onSubscriptionUpdated?: (subscription: any) => Promise<void>;
  onSubscriptionCanceled?: (subscription: any) => Promise<void>;
  onPaymentFailed?: (payment: any, subscription: any) => Promise<void>;
  onPaymentSucceeded?: (payment: any, subscription: any) => Promise<void>;
  onInvoiceGenerated?: (invoice: any) => Promise<void>;
}

export interface SubscriptionBackendConfig {
  port: number;
  database: DatabaseConfig;
  payment: PaymentConfig;
  auth: AuthConfig;
  features?: FeaturesConfig;
  cors?: CorsConfig;
  rateLimit?: RateLimitConfig;
  hooks?: LifecycleHooks;
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

// Payment Adapter types
export interface CreatePaymentParams {
  amount: number;
  currency: string;
  customerId: string;
  metadata?: Record<string, any>;
}

export interface CreatePaymentResult {
  paymentId: string;
  status: 'pending' | 'succeeded' | 'failed';
  providerResponse: any;
}

export interface RefundPaymentParams {
  paymentId: string;
  amount?: number;
  reason?: string;
}

export interface RefundPaymentResult {
  refundId: string;
  status: 'succeeded' | 'failed';
}

export interface VerifyWebhookParams {
  payload: string;
  signature: string;
  secret: string;
}

export interface ProcessWebhookResult {
  eventType: string;
  paymentId: string;
  status: string;
  metadata: any;
}

export interface PaymentAdapter {
  name: string;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult>;
  verifyWebhook(params: VerifyWebhookParams): boolean;
  processWebhook(payload: any): Promise<ProcessWebhookResult>;
}

// Service types
export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginationResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Logger interface
export interface Logger {
  info(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

// Subscription Backend Instance
export interface SubscriptionBackend {
  app: any; // Express app
  server: Server | null;
  services: {
    plans: any;
    subscriptions: any;
    invoices: any;
    payments: any;
    usage: any;
    analytics: any;
    webhooks: any;
  };
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

// API Error types
export interface ApiError {
  code: string;
  message: string;
  details?: any;
  requestId?: string;
}

export class SubscriptionError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'SubscriptionError';
  }
}
