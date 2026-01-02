import { Router } from 'express';
import { PlanService } from '../services/planService';
import { SubscriptionService } from '../services/subscriptionService';
import { InvoiceService } from '../services/invoiceService';
import { PaymentService } from '../services/paymentService';
import { UsageService } from '../services/usageService';
import { AnalyticsService } from '../services/analyticsService';
import { createPlanRoutes } from './plans';
import { AuthenticatedRequest } from '../types';
import {
  validate,
  createSubscriptionSchema,
  cancelSubscriptionSchema,
  pauseSubscriptionSchema,
  createUsageSchema,
  refundPaymentSchema,
  paginationSchema,
} from '../utils/validators';
import { SubscriptionStatus, InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';

export function createRoutes(
  planService: PlanService,
  subscriptionService: SubscriptionService,
  invoiceService: InvoiceService,
  paymentService: PaymentService,
  usageService: UsageService,
  analyticsService: AnalyticsService
): Router {
  const router = Router();

  router.use('/plans', createPlanRoutes(planService));

  const subsRouter = Router();

  subsRouter.post('/', async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = validate(createSubscriptionSchema, req.body);
      const subscription = await subscriptionService.create({
        tenantId: req.auth!.tenantId,
        userId: data.user_id || req.auth!.userId,
        planId: data.plan_id,
        quantity: data.quantity,
        trialPeriodDays: data.trial_period_days,
        metadata: data.metadata as Prisma.InputJsonValue,
      });
      res.status(201).json(subscription);
    } catch (error) {
      next(error);
    }
  });

  subsRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
    try {
      const { page, limit } = validate(paginationSchema, {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });

      const result = await subscriptionService.list(req.auth!.tenantId, {
        page,
        limit,
        userId: req.query.user_id as string,
        status: req.query.status as SubscriptionStatus,
        planId: req.query.plan_id as string,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  subsRouter.get('/:id', async (req: AuthenticatedRequest, res, next) => {
    try {
      const subscription = await subscriptionService.findById(req.params.id, req.auth!.tenantId);
      res.json(subscription);
    } catch (error) {
      next(error);
    }
  });

  subsRouter.post('/:id/cancel', async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = validate(cancelSubscriptionSchema, req.body);
      const subscription = await subscriptionService.cancel(
        req.params.id,
        req.auth!.tenantId,
        data
      );
      res.json(subscription);
    } catch (error) {
      next(error);
    }
  });

  subsRouter.post('/:id/pause', async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = validate(pauseSubscriptionSchema, req.body);
      const subscription = await subscriptionService.pause(req.params.id, req.auth!.tenantId, {
        resumeAt: data.resume_at ? new Date(data.resume_at) : undefined,
      });
      res.json(subscription);
    } catch (error) {
      next(error);
    }
  });

  subsRouter.post('/:id/resume', async (req: AuthenticatedRequest, res, next) => {
    try {
      const subscription = await subscriptionService.resume(req.params.id, req.auth!.tenantId);
      res.json(subscription);
    } catch (error) {
      next(error);
    }
  });

  router.use('/subscriptions', subsRouter);

  const invoicesRouter = Router();

  invoicesRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
    try {
      const { page, limit } = validate(paginationSchema, {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });

      const result = await invoiceService.list(req.auth!.tenantId, {
        page,
        limit,
        userId: req.query.user_id as string,
        subscriptionId: req.query.subscription_id as string,
        status: req.query.status as InvoiceStatus,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  invoicesRouter.get('/:id', async (req: AuthenticatedRequest, res, next) => {
    try {
      const invoice = await invoiceService.findById(req.params.id, req.auth!.tenantId);
      res.json(invoice);
    } catch (error) {
      next(error);
    }
  });

  router.use('/invoices', invoicesRouter);

  const paymentsRouter = Router();

  paymentsRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
    try {
      const { page, limit } = validate(paginationSchema, {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });

      const result = await paymentService.list(req.auth!.tenantId, {
        page,
        limit,
        userId: req.query.user_id as string,
        invoiceId: req.query.invoice_id as string,
        status: req.query.status as PaymentStatus,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  paymentsRouter.get('/:id', async (req: AuthenticatedRequest, res, next) => {
    try {
      const payment = await paymentService.findById(req.params.id, req.auth!.tenantId);
      res.json(payment);
    } catch (error) {
      next(error);
    }
  });

  paymentsRouter.post('/:id/refund', async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = validate(refundPaymentSchema, req.body);
      const payment = await paymentService.refund(req.params.id, req.auth!.tenantId, data);
      res.json(payment);
    } catch (error) {
      next(error);
    }
  });

  router.use('/payments', paymentsRouter);

  const usageRouter = Router();

  usageRouter.post('/', async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = validate(createUsageSchema, req.body);
      const usage = await usageService.record({
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        subscriptionId: data.subscription_id,
        metricName: data.metric_name,
        quantity: data.quantity,
        timestamp: data.timestamp ? new Date(data.timestamp) : undefined,
        metadata: data.metadata as Prisma.InputJsonValue,
      });
      res.status(201).json(usage);
    } catch (error) {
      next(error);
    }
  });

  usageRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await usageService.list(req.auth!.tenantId, {
        subscriptionId: req.query.subscription_id as string,
        metricName: req.query.metric_name as string,
        startDate: req.query.start_date ? new Date(req.query.start_date as string) : undefined,
        endDate: req.query.end_date ? new Date(req.query.end_date as string) : undefined,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.use('/usage', usageRouter);

  const analyticsRouter = Router();

  analyticsRouter.get('/mrr', async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await analyticsService.getMRR(req.auth!.tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  analyticsRouter.get('/churn', async (req: AuthenticatedRequest, res, next) => {
    try {
      const period = req.query.period as 'month' | 'quarter' | 'year' | undefined;
      const result = await analyticsService.getChurn(req.auth!.tenantId, period);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  analyticsRouter.get('/revenue', async (req: AuthenticatedRequest, res, next) => {
    try {
      const groupBy = req.query.group_by as 'day' | 'week' | 'month' | undefined;
      const result = await analyticsService.getRevenue(
        req.auth!.tenantId,
        undefined,
        undefined,
        groupBy
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.use('/analytics', analyticsRouter);

  router.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      database: 'connected',
      payment_provider: 'operational',
      uptime: process.uptime(),
    });
  });

  return router;
}
