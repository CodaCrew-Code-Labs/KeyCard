import { Router, Response, NextFunction } from 'express';
import { DodoPaymentsService } from '../services/dodoPaymentsService';
import {
  AuthenticatedRequest,
  CheckoutSessionData,
  ExtendedCheckoutResponse,
  WebhookData,
  PaymentData,
  SubscriptionData,
} from '../types';
import { WebhookUtils } from '../utils/webhookUtils';
import { getPrismaClient } from '../database/client';
import {
  getTierCodeFromProductId,
  getTierFromProductId,
  calculateTierExpiration,
} from '../config/tierMapping';
import crypto from 'crypto';
import { SessionStatus, PaymentStatus, SessionMode } from '@prisma/client';

export function createDodoPaymentsRoutes(): Router {
  const router = Router();

  /**
   * POST /subscribe
   * Creates a DoDo checkout session and stores the intent in the sessions table.
   * Sends user_uuid and requested_tier in metadata to DoDo for webhook correlation.
   */
  router.post(
    '/subscribe',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { product_id, customer_email, return_url } = req.body;

        if (!product_id) {
          return res.status(400).json({ error: 'product_id is required' });
        }

        if (!customer_email) {
          return res.status(400).json({ error: 'customer_email is required' });
        }

        // Find or fail - user must exist
        const user = await getPrismaClient().userMapping.findUnique({
          where: { email: customer_email },
        });

        if (!user) {
          return res.status(404).json({
            error: 'User not found. Create user first via POST /user',
          });
        }

        // Determine the requested tier from the product
        const tierConfig = getTierFromProductId(product_id);
        const requestedTier = tierConfig?.code || null;

        const client = DodoPaymentsService.getClient();

        const sessionData: CheckoutSessionData = {
          product_cart: [
            {
              product_id,
              quantity: 1,
            },
          ],
          return_url:
            return_url ||
            process.env.CHECKOUT_RETURN_URL ||
            'http://localhost:3000/checkout/success',
        };

        // Build metadata with user_uuid and requested_tier (critical for webhook correlation)
        const metadata: Record<string, string> = {
          user_uuid: user.userUuid,
          customer_email: customer_email,
        };

        if (requestedTier) {
          metadata.requested_tier = requestedTier;
        }

        // Use dodo_customer_id if exists, otherwise use email
        if (user.dodoCustomerId) {
          sessionData.customer = { customer_id: user.dodoCustomerId };
          metadata.dodo_customer_id = user.dodoCustomerId;
        } else {
          sessionData.customer = { email: customer_email };
        }

        sessionData.metadata = metadata;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const session = await client.checkoutSessions.create(sessionData as any);

        // Insert session row with all required fields
        await getPrismaClient().session.create({
          data: {
            sessionId: session.session_id,
            userUuid: user.userUuid,
            status: SessionStatus.PENDING,
            mode: SessionMode.SUBSCRIPTION,
            requestedTier: requestedTier,
          },
        });

        console.log(`✅ Created checkout session ${session.session_id} for user ${user.userUuid}`);

        res.json({
          success: true,
          session_url: session.checkout_url,
          session_id: session.session_id,
          requested_tier: requestedTier,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /checkout/:id
   * Retrieves checkout session from DoDo and updates local session record.
   * Use this as a fallback - webhook is the primary source of truth.
   */
  router.get(
    '/checkout/:id',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;

        if (!id) {
          return res.status(400).json({ error: 'checkout id is required' });
        }

        const client = DodoPaymentsService.getClient();

        const checkout = await client.checkoutSessions.retrieve(id);
        const checkoutData = checkout as unknown as ExtendedCheckoutResponse;

        // Update session in database
        const updateData: {
          status?: SessionStatus;
          paymentId?: string;
          subscriptionId?: string;
          completedAt?: Date;
        } = {};

        // Map DoDo status to our SessionStatus enum
        if (checkoutData.status) {
          const statusMap: Record<string, SessionStatus> = {
            succeeded: SessionStatus.COMPLETED,
            completed: SessionStatus.COMPLETED,
            paid: SessionStatus.COMPLETED,
            pending: SessionStatus.PENDING,
            failed: SessionStatus.FAILED,
            expired: SessionStatus.EXPIRED,
            cancelled: SessionStatus.FAILED,
          };
          updateData.status = statusMap[checkoutData.status.toLowerCase()] || SessionStatus.PENDING;

          if (updateData.status === SessionStatus.COMPLETED) {
            updateData.completedAt = new Date();
          }
        }

        // Store payment_id and subscription_id if present
        if (checkoutData.payment_id) {
          updateData.paymentId = checkoutData.payment_id;
        }

        if (checkoutData.subscription_id) {
          updateData.subscriptionId = checkoutData.subscription_id;
        }

        // Update the session
        if (Object.keys(updateData).length > 0) {
          await getPrismaClient().session.updateMany({
            where: { sessionId: id },
            data: updateData,
          });
          console.log(`✅ Updated session ${id}:`, updateData);
        }

        res.json(checkout);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /session/:sessionId
   * Get session details from local database with user info.
   */
  router.get(
    '/session/:sessionId',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { sessionId } = req.params;

        if (!sessionId) {
          return res.status(400).json({ error: 'session ID is required' });
        }

        const session = await getPrismaClient().session.findFirst({
          where: { sessionId },
          include: {
            user: {
              select: {
                email: true,
                userUuid: true,
                activeTier: true,
                tierExpiresAt: true,
              },
            },
            payments: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });

        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        res.json({
          session_id: session.sessionId,
          status: session.status,
          mode: session.mode,
          requested_tier: session.requestedTier,
          payment_id: session.paymentId,
          subscription_id: session.subscriptionId,
          created_date: session.createdDate,
          completed_at: session.completedAt,
          user: {
            email: session.user.email,
            user_uuid: session.user.userUuid,
            active_tier: session.user.activeTier,
            tier_expires_at: session.user.tierExpiresAt,
          },
          latest_payment: session.payments[0] || null,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /sync-session/:sessionId
   * Manual repair endpoint to sync session data from DoDo.
   * Use when webhooks fail or you need to reconcile state.
   */
  router.post(
    '/sync-session/:sessionId',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { sessionId } = req.params;

        if (!sessionId) {
          return res.status(400).json({ error: 'sessionId is required' });
        }

        // Get existing session from DB
        const existingSession = await getPrismaClient().session.findUnique({
          where: { sessionId },
          include: { user: true },
        });

        if (!existingSession) {
          return res.status(404).json({ error: 'Session not found in database' });
        }

        const client = DodoPaymentsService.getClient();

        // Fetch checkout session from DoDo
        const checkout = await client.checkoutSessions.retrieve(sessionId);
        const checkoutData = checkout as unknown as ExtendedCheckoutResponse;

        const results: {
          session_updated: boolean;
          payment_upserted: boolean;
          user_tier_updated: boolean;
          details: Record<string, unknown>;
        } = {
          session_updated: false,
          payment_upserted: false,
          user_tier_updated: false,
          details: {},
        };

        // Update session status
        const sessionUpdateData: {
          status?: SessionStatus;
          paymentId?: string;
          subscriptionId?: string;
          completedAt?: Date;
        } = {};

        if (checkoutData.status) {
          const statusMap: Record<string, SessionStatus> = {
            succeeded: SessionStatus.COMPLETED,
            completed: SessionStatus.COMPLETED,
            paid: SessionStatus.COMPLETED,
            pending: SessionStatus.PENDING,
            failed: SessionStatus.FAILED,
            expired: SessionStatus.EXPIRED,
          };
          sessionUpdateData.status =
            statusMap[checkoutData.status.toLowerCase()] || SessionStatus.PENDING;
        }

        if (checkoutData.payment_id) {
          sessionUpdateData.paymentId = checkoutData.payment_id;
        }

        if (checkoutData.subscription_id) {
          sessionUpdateData.subscriptionId = checkoutData.subscription_id;
        }

        if (sessionUpdateData.status === SessionStatus.COMPLETED && !existingSession.completedAt) {
          sessionUpdateData.completedAt = new Date();
        }

        if (Object.keys(sessionUpdateData).length > 0) {
          await getPrismaClient().session.update({
            where: { sessionId },
            data: sessionUpdateData,
          });
          results.session_updated = true;
          results.details.session = sessionUpdateData;
        }

        // If we have a payment_id, try to upsert payment record
        if (checkoutData.payment_id) {
          // Determine tier from product cart or existing session
          let tier = existingSession.requestedTier;
          if (checkoutData.product_cart && checkoutData.product_cart.length > 0) {
            const tierCode = getTierCodeFromProductId(checkoutData.product_cart[0].product_id);
            if (tierCode) tier = tierCode;
          }

          const paymentData = {
            userUuid: existingSession.userUuid,
            sessionId: sessionId,
            status:
              sessionUpdateData.status === SessionStatus.COMPLETED
                ? PaymentStatus.COMPLETED
                : PaymentStatus.PENDING,
            tier: tier,
            dodoSubscriptionId: checkoutData.subscription_id || null,
            paidAt: sessionUpdateData.status === SessionStatus.COMPLETED ? new Date() : null,
            rawJson: checkout as object,
          };

          await getPrismaClient().payment.upsert({
            where: { dodoPaymentId: checkoutData.payment_id },
            create: {
              ...paymentData,
              dodoPaymentId: checkoutData.payment_id,
            },
            update: paymentData,
          });
          results.payment_upserted = true;
          results.details.payment = { dodoPaymentId: checkoutData.payment_id, ...paymentData };

          // Update user tier if payment succeeded
          if (sessionUpdateData.status === SessionStatus.COMPLETED && tier) {
            const tierConfig = getTierFromProductId(
              checkoutData.product_cart?.[0]?.product_id || ''
            );

            await getPrismaClient().userMapping.update({
              where: { userUuid: existingSession.userUuid },
              data: {
                activeTier: tier,
                tierExpiresAt: tierConfig ? calculateTierExpiration(tierConfig) : null,
              },
            });
            results.user_tier_updated = true;
            results.details.user_tier = tier;
          }
        }

        console.log(`✅ Synced session ${sessionId}:`, results);

        res.json({
          success: true,
          session_id: sessionId,
          ...results,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /webhook
   * DoDo Payments webhook handler.
   * This is the source of truth for payment/subscription state.
   */
  router.post('/webhook', async (req, res) => {
    console.log('=== DoDo Payments Webhook Received ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('Event Type:', req.body?.event_type);
    console.log('Event (alternative):', req.body?.event);
    console.log('Type (alternative):', req.body?.type);
    console.log('Timestamp:', new Date().toISOString());

    // Verify signature if webhook key is configured
    const signatureValid = await verifyWebhookSignature(req);

    if (!signatureValid && process.env.NODE_ENV === 'production') {
      console.log('❌ Webhook signature verification failed in production');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    try {
      // Check for different possible event type field names
      const eventType = req.body?.event_type || req.body?.event || req.body?.type;

      if (!eventType) {
        console.log('⚠️ No event type found in webhook payload');
        console.log('Available keys:', Object.keys(req.body || {}));
        return res.json({ received: true, error: 'No event type found' });
      }

      // Create normalized payload
      const normalizedPayload = {
        event_type: eventType,
        data: req.body?.data || req.body,
      };

      // Process the webhook
      await processWebhookPayload(normalizedPayload);

      console.log('=====================================');
      res.json({ received: true });
    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      // Still return 200 to prevent retries for processing errors
      res.json({ received: true, error: 'Processing error' });
    }
  });

  return router;
}

/**
 * Verify webhook signature using Standard Webhooks spec
 */
async function verifyWebhookSignature(req: AuthenticatedRequest): Promise<boolean> {
  if (!process.env.DODO_PAYMENTS_WEBHOOK_KEY) {
    console.log('⚠️ DODO_PAYMENTS_WEBHOOK_KEY not configured, skipping signature verification');
    return true;
  }

  const webhookId = req.headers['webhook-id'] as string;
  const webhookSignature = req.headers['webhook-signature'] as string;
  const webhookTimestamp = req.headers['webhook-timestamp'] as string;

  if (!webhookId || !webhookSignature || !webhookTimestamp) {
    console.log('❌ Missing required webhook headers');
    return false;
  }

  try {
    const rawPayload = JSON.stringify(req.body);
    const signedMessage = `${webhookId}.${webhookTimestamp}.${rawPayload}`;

    const secretKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY.replace('whsec_', '');

    const computedSignature = crypto
      .createHmac('sha256', Buffer.from(secretKey, 'base64'))
      .update(signedMessage, 'utf8')
      .digest('base64');

    const headerSignature = webhookSignature.replace('v1,', '');

    if (computedSignature === headerSignature) {
      console.log('✅ Webhook signature verified');
      return true;
    }

    console.log('❌ Signature mismatch');
    return false;
  } catch (error) {
    console.error('❌ Signature verification error:', error);
    return false;
  }
}

/**
 * Process webhook payload - the main webhook handler logic
 */
async function processWebhookPayload(payload: WebhookData): Promise<void> {
  const { event_type, data } = payload;

  console.log(`Processing webhook event: ${event_type}`);

  switch (event_type) {
    case 'payment.succeeded':
      await handlePaymentSucceeded(data as unknown as PaymentData, payload);
      break;

    case 'payment.failed':
      await handlePaymentFailed(data as unknown as PaymentData, payload);
      break;

    case 'subscription.created':
      await handleSubscriptionCreated(data as unknown as SubscriptionData, payload);
      break;

    case 'subscription.active':
      await handleSubscriptionActive(data as unknown as SubscriptionData, payload);
      break;

    case 'subscription.updated':
      await handleSubscriptionUpdated(data as unknown as SubscriptionData, payload);
      break;

    case 'subscription.renewed':
      await handleSubscriptionRenewed(data as unknown as SubscriptionData, payload);
      break;

    case 'subscription.cancelled':
    case 'subscription.canceled':
      await handleSubscriptionCancelled(data as unknown as SubscriptionData, payload);
      break;

    case 'subscription.expired':
      await handleSubscriptionExpired(data as unknown as SubscriptionData, payload);
      break;

    case 'customer.created':
      await WebhookUtils.handleCustomerCreated(data);
      break;

    default:
      console.log(`Unhandled webhook event: ${event_type}`);
  }
}

/**
 * Handle payment.succeeded webhook event
 * This is the key handler that upserts payment and updates user tier.
 */
async function handlePaymentSucceeded(data: PaymentData, rawPayload: WebhookData): Promise<void> {
  console.log('Processing payment.succeeded:', data.payment_id);

  // Extract user_uuid from metadata (sent during subscribe)
  const userUuid = data.metadata?.user_uuid;
  const customerEmail = data.metadata?.customer_email || data.customer?.email;

  if (!userUuid && !customerEmail) {
    console.error('❌ No user_uuid or customer_email in payment metadata');
    return;
  }

  // Find user
  let user;
  if (userUuid) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { userUuid },
    });
  }

  if (!user && customerEmail) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { email: customerEmail },
    });
  }

  if (!user) {
    console.error('❌ User not found for payment');
    return;
  }

  // Determine tier from product cart or metadata
  let tier = data.metadata?.requested_tier || null;
  if (!tier && data.product_cart && data.product_cart.length > 0) {
    tier = getTierCodeFromProductId(data.product_cart[0].product_id);
  }

  // Upsert payment record
  const paymentRecord = {
    userUuid: user.userUuid,
    status: PaymentStatus.COMPLETED,
    amountCents: data.total_amount || null,
    currency: data.currency || null,
    tier: tier,
    dodoSubscriptionId: data.subscription_id || null,
    paidAt: new Date(),
    rawJson: rawPayload as object,
  };

  await getPrismaClient().payment.upsert({
    where: { dodoPaymentId: data.payment_id },
    create: {
      ...paymentRecord,
      dodoPaymentId: data.payment_id,
    },
    update: paymentRecord,
  });

  console.log(`✅ Upserted payment ${data.payment_id}`);

  // Update session if we can find one
  // Try to find session via metadata or by matching user's pending sessions
  const sessionId = data.metadata?.session_id;
  if (sessionId) {
    await getPrismaClient().session.updateMany({
      where: { sessionId },
      data: {
        status: SessionStatus.COMPLETED,
        paymentId: data.payment_id,
        subscriptionId: data.subscription_id || null,
        completedAt: new Date(),
      },
    });
    console.log(`✅ Updated session ${sessionId}`);

    // Also update the payment with session_id
    await getPrismaClient().payment.update({
      where: { dodoPaymentId: data.payment_id },
      data: { sessionId },
    });
  }

  // Update user tier (source of truth)
  if (tier) {
    const tierConfig = data.product_cart?.[0]?.product_id
      ? getTierFromProductId(data.product_cart[0].product_id)
      : null;

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: tier,
        tierExpiresAt: tierConfig ? calculateTierExpiration(tierConfig) : null,
        dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
      },
    });

    console.log(`✅ Updated user ${user.userUuid} tier to ${tier}`);
  }
}

/**
 * Handle payment.failed webhook event
 */
async function handlePaymentFailed(data: PaymentData, rawPayload: WebhookData): Promise<void> {
  console.log('Processing payment.failed:', data.payment_id);

  const userUuid = data.metadata?.user_uuid;
  const customerEmail = data.metadata?.customer_email || data.customer?.email;

  let user;
  if (userUuid) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { userUuid },
    });
  }
  if (!user && customerEmail) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { email: customerEmail },
    });
  }

  if (!user) {
    console.error('❌ User not found for failed payment');
    return;
  }

  // Upsert failed payment record
  await getPrismaClient().payment.upsert({
    where: { dodoPaymentId: data.payment_id },
    create: {
      dodoPaymentId: data.payment_id,
      userUuid: user.userUuid,
      status: PaymentStatus.FAILED,
      amountCents: data.total_amount || null,
      currency: data.currency || null,
      rawJson: rawPayload as object,
    },
    update: {
      status: PaymentStatus.FAILED,
      rawJson: rawPayload as object,
    },
  });

  console.log(`✅ Recorded failed payment ${data.payment_id}`);

  // Update session if found
  const sessionId = data.metadata?.session_id;
  if (sessionId) {
    await getPrismaClient().session.updateMany({
      where: { sessionId },
      data: {
        status: SessionStatus.FAILED,
        paymentId: data.payment_id,
      },
    });
  }
}

/**
 * Handle subscription.created webhook event
 */
async function handleSubscriptionCreated(
  data: SubscriptionData,
  rawPayload: WebhookData
): Promise<void> {
  console.log('Processing subscription.created:', data.subscription_id);

  const userUuid = data.metadata?.user_uuid;
  const customerEmail = data.metadata?.customer_email || data.customer?.email;

  let user;
  if (userUuid) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { userUuid },
    });
  }
  if (!user && customerEmail) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { email: customerEmail },
    });
  }

  if (!user) {
    console.error('❌ User not found for subscription');
    return;
  }

  // Update user's dodo_customer_id if not set
  if (data.customer?.customer_id && !user.dodoCustomerId) {
    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: { dodoCustomerId: data.customer.customer_id },
    });
    console.log(`✅ Updated dodo_customer_id for ${user.email}`);
  }

  // Determine tier
  let tier = data.metadata?.requested_tier || null;
  if (!tier && data.product_id) {
    tier = getTierCodeFromProductId(data.product_id);
  }

  // Update user tier with subscription period
  if (tier && data.status === 'active') {
    const tierConfig = data.product_id ? getTierFromProductId(data.product_id) : null;

    // DoDo uses expires_at for subscription expiration
    const expiresAt = data.expires_at || data.current_period_end;

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: tier,
        tierExpiresAt: expiresAt
          ? new Date(expiresAt)
          : tierConfig
            ? calculateTierExpiration(tierConfig)
            : null,
      },
    });

    console.log(`✅ Updated user ${user.userUuid} tier to ${tier}`);
  }

  // Log the raw subscription data for debugging
  console.log('Subscription data:', JSON.stringify(rawPayload, null, 2));
}

/**
 * Handle subscription.active webhook event
 * This is fired when a subscription becomes active (initial activation or reactivation)
 */
async function handleSubscriptionActive(
  data: SubscriptionData,
  rawPayload: WebhookData
): Promise<void> {
  console.log('Processing subscription.active:', data.subscription_id);

  const userUuid = data.metadata?.user_uuid;
  const customerEmail = data.metadata?.customer_email || data.customer?.email;

  let user;
  if (userUuid) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { userUuid },
    });
  }
  if (!user && customerEmail) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { email: customerEmail },
    });
  }

  if (!user) {
    console.error('❌ User not found for subscription');
    return;
  }

  // Update dodo_customer_id if available
  if (data.customer?.customer_id && !user.dodoCustomerId) {
    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: { dodoCustomerId: data.customer.customer_id },
    });
    console.log(`✅ Updated dodo_customer_id for ${user.email}`);
  }

  // Determine tier
  let tier = data.metadata?.requested_tier || null;
  if (!tier && data.product_id) {
    tier = getTierCodeFromProductId(data.product_id);
  }

  // DoDo uses expires_at for subscription expiration
  const expiresAt = data.expires_at || data.current_period_end;

  // Update user tier with new period
  if (tier) {
    const tierConfig = data.product_id ? getTierFromProductId(data.product_id) : null;

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: tier,
        tierExpiresAt: expiresAt
          ? new Date(expiresAt)
          : tierConfig
            ? calculateTierExpiration(tierConfig)
            : null,
        dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
      },
    });

    console.log(
      `✅ Activated subscription for user ${user.userUuid}, tier set to ${tier}, expires at ${expiresAt}`
    );
  }

  // Update session table - find session by user and update with subscription_id
  // First try to find a pending session for this user
  const pendingSession = await getPrismaClient().session.findFirst({
    where: {
      userUuid: user.userUuid,
      status: SessionStatus.PENDING,
    },
    orderBy: { createdDate: 'desc' },
  });

  if (pendingSession) {
    await getPrismaClient().session.update({
      where: { id: pendingSession.id },
      data: {
        status: SessionStatus.COMPLETED,
        subscriptionId: data.subscription_id,
        completedAt: new Date(),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });
    console.log(
      `✅ Updated session ${pendingSession.sessionId} to COMPLETED with subscription ${data.subscription_id}`
    );

    // Create a payment record for this subscription activation
    // Use subscription_id as a pseudo payment_id since subscription webhooks don't have payment_id
    const pseudoPaymentId = `sub_payment_${data.subscription_id}`;

    await getPrismaClient().payment.upsert({
      where: { dodoPaymentId: pseudoPaymentId },
      create: {
        dodoPaymentId: pseudoPaymentId,
        userUuid: user.userUuid,
        sessionId: pendingSession.sessionId,
        status: PaymentStatus.COMPLETED,
        amountCents: data.recurring_pre_tax_amount || null,
        currency: data.currency || null,
        tier: tier,
        dodoSubscriptionId: data.subscription_id,
        paidAt: new Date(),
        rawJson: rawPayload as object,
      },
      update: {
        status: PaymentStatus.COMPLETED,
        amountCents: data.recurring_pre_tax_amount || null,
        currency: data.currency || null,
        tier: tier,
        paidAt: new Date(),
        rawJson: rawPayload as object,
      },
    });
    console.log(`✅ Created/updated payment record for subscription ${data.subscription_id}`);
  } else {
    // No pending session found, try to update any session with this subscription_id
    const existingSession = await getPrismaClient().session.findFirst({
      where: { subscriptionId: data.subscription_id },
    });

    if (existingSession) {
      await getPrismaClient().session.update({
        where: { id: existingSession.id },
        data: {
          status: SessionStatus.COMPLETED,
          completedAt: existingSession.completedAt || new Date(),
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });
      console.log(`✅ Updated existing session with subscription ${data.subscription_id}`);
    }
  }
}

/**
 * Handle subscription.cancelled webhook event
 */
async function handleSubscriptionCancelled(
  data: SubscriptionData,
  _rawPayload: WebhookData
): Promise<void> {
  console.log('Processing subscription.cancelled:', data.subscription_id);

  const userUuid = data.metadata?.user_uuid;
  const customerEmail = data.metadata?.customer_email || data.customer?.email;

  let user;
  if (userUuid) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { userUuid },
    });
  }
  if (!user && customerEmail) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { email: customerEmail },
    });
  }

  if (!user) {
    console.error('❌ User not found for subscription cancellation');
    return;
  }

  // Set tier to FREE and clear expiration
  await getPrismaClient().userMapping.update({
    where: { userUuid: user.userUuid },
    data: {
      activeTier: 'FREE',
      tierExpiresAt: data.cancelled_at ? new Date(data.cancelled_at) : new Date(),
    },
  });

  console.log(`✅ Cancelled subscription for user ${user.userUuid}, tier set to FREE`);
}

/**
 * Handle subscription.expired webhook event
 */
async function handleSubscriptionExpired(
  data: SubscriptionData,
  _rawPayload: WebhookData
): Promise<void> {
  console.log('Processing subscription.expired:', data.subscription_id);

  const userUuid = data.metadata?.user_uuid;
  const customerEmail = data.metadata?.customer_email || data.customer?.email;

  let user;
  if (userUuid) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { userUuid },
    });
  }
  if (!user && customerEmail) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { email: customerEmail },
    });
  }

  if (!user) {
    console.error('❌ User not found for subscription expiration');
    return;
  }

  // Set tier to FREE
  await getPrismaClient().userMapping.update({
    where: { userUuid: user.userUuid },
    data: {
      activeTier: 'FREE',
      tierExpiresAt: new Date(),
    },
  });

  console.log(`✅ Subscription expired for user ${user.userUuid}, tier set to FREE`);
}

/**
 * Handle subscription.updated webhook event
 * This is fired when subscription details are updated (e.g., billing info, quantity changes)
 */
async function handleSubscriptionUpdated(
  data: SubscriptionData,
  _rawPayload: WebhookData
): Promise<void> {
  console.log('Processing subscription.updated:', data.subscription_id);

  const userUuid = data.metadata?.user_uuid;
  const customerEmail = data.metadata?.customer_email || data.customer?.email;

  let user;
  if (userUuid) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { userUuid },
    });
  }
  if (!user && customerEmail) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { email: customerEmail },
    });
  }

  if (!user) {
    console.error('❌ User not found for subscription update');
    return;
  }

  // Update dodo_customer_id if available
  if (data.customer?.customer_id && !user.dodoCustomerId) {
    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: { dodoCustomerId: data.customer.customer_id },
    });
  }

  // Determine tier from product_id or metadata
  let tier = data.metadata?.requested_tier || null;
  if (!tier && data.product_id) {
    tier = getTierCodeFromProductId(data.product_id);
  }

  const expiresAt = data.expires_at || data.current_period_end;

  // Only update tier if subscription is active
  if (data.status === 'active' && tier) {
    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: tier,
        tierExpiresAt: expiresAt ? new Date(expiresAt) : user.tierExpiresAt,
        dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
      },
    });

    console.log(
      `✅ Updated subscription for user ${user.userUuid}, tier: ${tier}, expires at ${expiresAt}`
    );
  } else if (data.status === 'cancelled' || data.status === 'expired') {
    // If subscription was updated to cancelled/expired status
    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: 'FREE',
        tierExpiresAt: data.cancelled_at ? new Date(data.cancelled_at) : new Date(),
      },
    });

    console.log(
      `✅ Subscription updated to ${data.status} for user ${user.userUuid}, tier set to FREE`
    );
  } else {
    console.log(`✅ Subscription updated for user ${user.userUuid}, status: ${data.status}`);
  }

  // Update session table if we have a session with this subscription_id
  const existingSession = await getPrismaClient().session.findFirst({
    where: { subscriptionId: data.subscription_id },
  });

  if (existingSession) {
    const sessionStatus =
      data.status === 'active'
        ? SessionStatus.COMPLETED
        : data.status === 'cancelled' || data.status === 'expired'
          ? SessionStatus.EXPIRED
          : existingSession.status;

    await getPrismaClient().session.update({
      where: { id: existingSession.id },
      data: {
        status: sessionStatus,
        expiresAt: expiresAt ? new Date(expiresAt) : existingSession.expiresAt,
      },
    });
    console.log(`✅ Updated session ${existingSession.sessionId} status to ${sessionStatus}`);
  }
}

/**
 * Handle subscription.renewed webhook event
 * This is fired when a subscription is renewed (recurring payment successful)
 */
async function handleSubscriptionRenewed(
  data: SubscriptionData,
  _rawPayload: WebhookData
): Promise<void> {
  console.log('Processing subscription.renewed:', data.subscription_id);

  const userUuid = data.metadata?.user_uuid;
  const customerEmail = data.metadata?.customer_email || data.customer?.email;

  let user;
  if (userUuid) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { userUuid },
    });
  }
  if (!user && customerEmail) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { email: customerEmail },
    });
  }

  if (!user) {
    console.error('❌ User not found for subscription renewal');
    return;
  }

  // Determine tier from product_id or metadata
  let tier = data.metadata?.requested_tier || null;
  if (!tier && data.product_id) {
    tier = getTierCodeFromProductId(data.product_id);
  }

  // Use existing tier if none found
  if (!tier) {
    tier = user.activeTier;
  }

  // DoDo uses expires_at for subscription expiration
  const expiresAt = data.expires_at || data.current_period_end;

  if (tier) {
    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: tier,
        tierExpiresAt: expiresAt ? new Date(expiresAt) : user.tierExpiresAt,
        dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
      },
    });

    console.log(
      `✅ Renewed subscription for user ${user.userUuid}, tier: ${tier}, new expiration: ${expiresAt}`
    );
  } else {
    console.log(`⚠️ Subscription renewed but no tier found for user ${user.userUuid}`);
  }

  // Find the session associated with this subscription
  const existingSession = await getPrismaClient().session.findFirst({
    where: { subscriptionId: data.subscription_id },
  });

  // Update session expiration
  if (existingSession) {
    await getPrismaClient().session.update({
      where: { id: existingSession.id },
      data: {
        expiresAt: expiresAt ? new Date(expiresAt) : existingSession.expiresAt,
      },
    });
    console.log(`✅ Updated session ${existingSession.sessionId} expiration to ${expiresAt}`);
  }

  // NOTE: We don't create a payment record here because DoDo sends both
  // subscription.renewed AND subscription.active events for the same payment.
  // The payment record is created in handleSubscriptionActive to avoid duplicates.
}
