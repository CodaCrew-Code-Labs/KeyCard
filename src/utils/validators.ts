import { z } from 'zod';

// Plan validation schemas
export const createPlanSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  pricing_model: z.enum(['flat', 'tiered', 'per_seat', 'usage_based']),
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  billing_interval: z.enum(['day', 'week', 'month', 'year']),
  billing_interval_count: z.number().int().positive().default(1),
  trial_period_days: z.number().int().nonnegative().optional(),
  setup_fee: z.number().nonnegative().optional(),
  features: z.record(z.unknown()).default({}),
});

export const updatePlanSchema = createPlanSchema.partial();

// Subscription validation schemas
export const createSubscriptionSchema = z.object({
  user_id: z.string().optional(),
  plan_id: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  trial_period_days: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const updateSubscriptionSchema = z.object({
  plan_id: z.string().uuid().optional(),
  quantity: z.number().int().positive().optional(),
  proration_behavior: z.enum(['create_prorations', 'none', 'always_invoice']).optional(),
});

export const cancelSubscriptionSchema = z.object({
  cancel_at_period_end: z.boolean().default(true),
  reason: z.string().optional(),
});

export const pauseSubscriptionSchema = z.object({
  resume_at: z.string().datetime().optional(),
});

// Usage validation schemas
export const createUsageSchema = z.object({
  subscription_id: z.string().uuid(),
  metric_name: z.string().min(1),
  quantity: z.number().positive(),
  timestamp: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

// Payment validation schemas
export const createPaymentSchema = z.object({
  payment_method: z.string(),
  metadata: z.record(z.unknown()).default({}),
});

export const refundPaymentSchema = z.object({
  amount: z.number().positive().optional(),
  reason: z.string().optional(),
});

// Tenant validation schemas
export const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  webhook_url: z.string().url().optional(),
  settings: z.record(z.unknown()).default({}),
});

// Pagination validation
export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

// Helper function to validate data
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}
