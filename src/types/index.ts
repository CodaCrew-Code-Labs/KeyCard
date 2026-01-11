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

export interface CustomerData {
  customer_id?: string;
  email?: string;
}

export interface PaymentData {
  payment_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
}

export interface SubscriptionData {
  subscription_id?: string;
  customer_id?: string;
  status?: string;
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
