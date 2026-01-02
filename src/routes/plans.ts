import { Router } from 'express';
import { PlanService } from '../services/planService';
import { AuthenticatedRequest } from '../types';
import { validate, createPlanSchema, updatePlanSchema, paginationSchema } from '../utils/validators';

export function createPlanRoutes(planService: PlanService): Router {
  const router = Router();

  // POST /api/v1/plans
  router.post('/', async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = validate(createPlanSchema, req.body);
      const plan = await planService.create({
        tenantId: req.auth!.tenantId,
        name: data.name,
        description: data.description,
        pricingModel: data.pricing_model,
        amount: data.amount,
        currency: data.currency,
        billingInterval: data.billing_interval,
        billingIntervalCount: data.billing_interval_count,
        trialPeriodDays: data.trial_period_days,
        setupFee: data.setup_fee,
        features: data.features,
      });
      res.status(201).json(plan);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/plans
  router.get('/', async (req: AuthenticatedRequest, res, next) => {
    try {
      const { page, limit } = validate(paginationSchema, {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });

      const result = await planService.list(req.auth!.tenantId, {
        page,
        limit,
        isActive: req.query.is_active === 'true' ? true : req.query.is_active === 'false' ? false : undefined,
        pricingModel: req.query.pricing_model as any,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/plans/:id
  router.get('/:id', async (req: AuthenticatedRequest, res, next) => {
    try {
      const plan = await planService.findById(req.params.id, req.auth!.tenantId);
      res.json(plan);
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/v1/plans/:id
  router.patch('/:id', async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = validate(updatePlanSchema, req.body);
      const plan = await planService.update(req.params.id, req.auth!.tenantId, data);
      res.json(plan);
    } catch (error) {
      next(error);
    }
  });

  // DELETE /api/v1/plans/:id
  router.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
    try {
      await planService.delete(req.params.id, req.auth!.tenantId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
