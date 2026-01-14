import { Router } from 'express';
import { createDodoPaymentsRoutes } from './dodoPayments';
import adminRouter from './admin';
import { getPrismaClient } from '../database/client';
import { v4 as uuidv4 } from 'uuid';
import { BillingResponse } from '../types';

// Far future date for FREE tier (effectively never expires)
const FREE_TIER_EXPIRY = new Date('2099-12-31T23:59:59.999Z');

export function createRoutes(): Router {
  const router = Router();

  router.use('/dodopayments', createDodoPaymentsRoutes());
  router.use('/admin', adminRouter);

  router.post('/user', async (req, res, next) => {
    try {
      const { email } = req.body;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'email is required in request body' });
      }

      // Check if user exists
      let user = await getPrismaClient().userMapping.findUnique({
        where: { email },
      });

      let isNewUser = false;

      if (!user) {
        // Create new user with generated UUID and FREE tier defaults
        const userUuid = uuidv4();

        user = await getPrismaClient().userMapping.create({
          data: {
            userUuid,
            email,
            activeTier: 'FREE',
            tierExpiresAt: FREE_TIER_EXPIRY,
            subscriptionStatus: null, // FREE users don't have a subscription
            // dodoCustomerId will be set during checkout when DoDo creates the customer
          },
        });
        isNewUser = true;
        console.log(`✅ Created user ${userUuid} with FREE tier`);
      } else {
        // Ensure existing users have FREE tier if they don't have any tier
        if (!user.activeTier) {
          user = await getPrismaClient().userMapping.update({
            where: { email },
            data: {
              activeTier: 'FREE',
              tierExpiresAt: FREE_TIER_EXPIRY,
            },
          });
          console.log(`✅ Updated existing user ${user.userUuid} to FREE tier`);
        }
      }

      res.json({
        uuid: user.userUuid,
        created: isNewUser,
        dodo_customer_id: user.dodoCustomerId,
        active_tier: user.activeTier,
        tier_expires_at: user.tierExpiresAt?.toISOString() || null,
        subscription_status: user.subscriptionStatus,
        message: isNewUser ? 'User created successfully' : 'User already exists',
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users', async (req, res, next) => {
    try {
      const users = await getPrismaClient().userMapping.findMany({
        select: {
          email: true,
        },
      });

      res.json({ emails: users.map((user) => user.email) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/user/:email', async (req, res, next) => {
    try {
      const { email } = req.params;

      const user = await getPrismaClient().userMapping.findUnique({
        where: { email },
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        email: user.email,
        sob_id: user.userUuid,
        dodo_customer_id: user.dodoCustomerId,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /user/:email/billing
   * Returns user's active tier and latest payment status.
   * This is the primary endpoint for checking subscription status.
   */
  router.get('/user/:email/billing', async (req, res, next) => {
    try {
      const { email } = req.params;

      // Get user with latest payment
      const user = await getPrismaClient().userMapping.findUnique({
        where: { email },
        include: {
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const latestPayment = user.payments[0];

      const response: BillingResponse = {
        activeTier: user.activeTier,
        tierExpiresAt: user.tierExpiresAt ? user.tierExpiresAt.toISOString() : null,
        latestPayment: latestPayment
          ? {
              status: latestPayment.status,
              paidAt: latestPayment.paidAt ? latestPayment.paidAt.toISOString() : null,
              amountCents: latestPayment.amountCents,
              currency: latestPayment.currency,
              tier: latestPayment.tier,
              dodoPaymentId: latestPayment.dodoPaymentId,
              createdAt: latestPayment.createdAt.toISOString(),
            }
          : null,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /user/:email/payments
   * Returns user's payment history.
   */
  router.get('/user/:email/payments', async (req, res, next) => {
    try {
      const { email } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;

      // First get the user
      const user = await getPrismaClient().userMapping.findUnique({
        where: { email },
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get payments with pagination
      const [payments, total] = await Promise.all([
        getPrismaClient().payment.findMany({
          where: { userUuid: user.userUuid },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        getPrismaClient().payment.count({
          where: { userUuid: user.userUuid },
        }),
      ]);

      res.json({
        payments: payments.map((p) => ({
          id: p.id,
          dodoPaymentId: p.dodoPaymentId,
          status: p.status,
          amountCents: p.amountCents,
          currency: p.currency,
          tier: p.tier,
          paidAt: p.paidAt?.toISOString() || null,
          createdAt: p.createdAt.toISOString(),
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + payments.length < total,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /user/:email/sessions
   * Returns user's checkout session history.
   */
  router.get('/user/:email/sessions', async (req, res, next) => {
    try {
      const { email } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;

      // First get the user
      const user = await getPrismaClient().userMapping.findUnique({
        where: { email },
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get sessions with pagination
      const [sessions, total] = await Promise.all([
        getPrismaClient().session.findMany({
          where: { userUuid: user.userUuid },
          orderBy: { createdDate: 'desc' },
          take: limit,
          skip: offset,
        }),
        getPrismaClient().session.count({
          where: { userUuid: user.userUuid },
        }),
      ]);

      res.json({
        sessions: sessions.map((s) => ({
          id: s.id,
          sessionId: s.sessionId,
          status: s.status,
          mode: s.mode,
          requestedTier: s.requestedTier,
          paymentId: s.paymentId,
          subscriptionId: s.subscriptionId,
          createdDate: s.createdDate.toISOString(),
          completedAt: s.completedAt?.toISOString() || null,
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + sessions.length < total,
        },
      });
    } catch (error) {
      next(error);
    }
  });

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
