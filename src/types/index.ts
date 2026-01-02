import { Request, Application } from 'express';
import { PrismaClient } from '@prisma/client';
import { Server } from 'http';
import type { PlanService } from '../services/planService';
import type { SubscriptionService } from '../services/subscriptionService';
import type { InvoiceService } from '../services/invoiceService';
import type { PaymentService } from '../services/paymentService';
import type { UsageService } from '../services/usageService';
import type { AnalyticsService } from '../services/analyticsService';
import type { WebhookService } from '../services/webhookService';

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
  config: Record<string, unknown>;
  customProcessor?: PaymentAdapter;
}

export interface AuthConfig {
  validateRequest: (req: Request) => Promise<AuthValidationResult>;
}

export interface DunningConfig {
  enabled: boolean;
  retrySchedule: number[];
  emailProvider?: string;
  emailConfig?: Record<string, unknown>;
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
  onSubscriptionCreated?: (subscription: unknown) => Promise<void>;
  onSubscriptionUpdated?: (subscription: unknown) => Promise<void>;
  onSubscriptionCanceled?: (subscription: unknown) => Promise<void>;
  onPaymentFailed?: (payment: unknown, subscription: unknown) => Promise<void>;
  onPaymentSucceeded?: (payment: unknown, subscription: unknown) => Promise<void>;
  onInvoiceGenerated?: (invoice: unknown) => Promise<void>;
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
  metadata?: Record<string, unknown>;
}

export interface CreatePaymentResult {
  paymentId: string;
  status: 'pending' | 'succeeded' | 'failed';
  providerResponse: Record<string, unknown>;
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
  metadata: Record<string, unknown> | undefined;
}

export interface PaymentAdapter {
  name: string;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult>;
  verifyWebhook(params: VerifyWebhookParams): boolean;
  processWebhook(payload: Record<string, unknown>): Promise<ProcessWebhookResult>;
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
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  debug(message: string, meta?: unknown): void;
}

// Subscription Backend Instance
export interface SubscriptionBackend {
  app: Application;
  server: Server | null;
  services: {
    plans: PlanService;
    subscriptions: SubscriptionService;
    invoices: InvoiceService;
    payments: PaymentService;
    usage: UsageService;
    analytics: AnalyticsService;
    webhooks: WebhookService;
  };
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

// API Error types
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

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
