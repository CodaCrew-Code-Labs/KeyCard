import { Router, Response, NextFunction } from 'express';
import { DodoPaymentsService } from '../services/dodoPaymentsService';
import {
  AuthenticatedRequest,
  CheckoutSessionData,
  ExtendedCheckoutResponse,
  WebhookData,
  PaymentData,
  SubscriptionData,
  DisputeData,
  RefundData,
} from '../types';
import { WebhookUtils } from '../utils/webhookUtils';
import { getPrismaClient } from '../database/client';
import {
  getTierCodeFromProductId,
  getTierFromProductId,
  calculateTierExpiration,
  getActiveLengthFromProductId,
} from '../config/tierMapping';
import crypto from 'crypto';
import { SessionStatus, PaymentStatus, SessionMode, SubscriptionStatus } from '@prisma/client';

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

        // Check for existing pending session that is not expired
        // This prevents duplicate sessions for the same user
        const existingSession = await getPrismaClient().session.findFirst({
          where: {
            userUuid: user.userUuid,
            status: SessionStatus.PENDING,
          },
          orderBy: { createdDate: 'desc' },
        });

        console.log(
          `🔍 Checking for existing pending session for user ${user.userUuid}:`,
          existingSession
            ? `Found session ${existingSession.sessionId}`
            : 'No pending session found'
        );

        if (existingSession) {
          const sessionAgeMs = Date.now() - existingSession.createdDate.getTime();
          const SESSION_FRESHNESS_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

          // If session is fresh (less than 15 minutes old), return URL directly without checking DoDo
          if (sessionAgeMs < SESSION_FRESHNESS_THRESHOLD_MS) {
            const baseUrl =
              process.env.DODO_CHECKOUT_BASE_URL || 'https://test.checkout.dodopayments.com';
            const checkoutUrl = `${baseUrl}/session/${existingSession.sessionId}`;

            console.log(
              `✅ Returning fresh existing checkout session ${existingSession.sessionId} (${Math.round(sessionAgeMs / 1000)}s old) for user ${user.userUuid}`
            );
            return res.json({
              success: true,
              session_url: checkoutUrl,
              session_id: existingSession.sessionId,
              requested_tier: existingSession.requestedTier,
              existing_session: true,
              message: 'Returning existing pending checkout session',
            });
          }

          // Session is older than 15 minutes - verify with DoDo
          console.log(
            `🔍 Session ${existingSession.sessionId} is ${Math.round(sessionAgeMs / 1000 / 60)} minutes old, verifying with DoDo...`
          );
          try {
            const client = DodoPaymentsService.getClient();
            const checkout = await client.checkoutSessions.retrieve(existingSession.sessionId);
            const checkoutData = checkout as unknown as ExtendedCheckoutResponse;

            // Check if the session is still valid (not yet paid/completed)
            // If payment_id is null, the checkout hasn't been completed yet
            if (!checkoutData.payment_id) {
              const baseUrl =
                process.env.DODO_CHECKOUT_BASE_URL || 'https://test.checkout.dodopayments.com';
              const checkoutUrl = `${baseUrl}/session/${existingSession.sessionId}`;

              console.log(
                `✅ Returning verified existing checkout session ${existingSession.sessionId} for user ${user.userUuid}`
              );
              return res.json({
                success: true,
                session_url: checkoutUrl,
                session_id: existingSession.sessionId,
                requested_tier: existingSession.requestedTier,
                existing_session: true,
                message: 'Returning existing pending checkout session',
              });
            }

            // If payment_id exists, the session has been used - mark as completed
            console.log(
              `⚠️ Existing checkout ${existingSession.sessionId} already has payment, marking as completed`
            );
            await getPrismaClient().session.update({
              where: { id: existingSession.id },
              data: { status: SessionStatus.COMPLETED, completedAt: new Date() },
            });
          } catch (_checkoutError) {
            // If we can't retrieve the checkout, it may have expired or been deleted
            // Mark the session as expired and continue to create a new one
            console.log(
              `⚠️ Could not retrieve existing checkout ${existingSession.sessionId}, marking as expired`
            );
            await getPrismaClient().session.update({
              where: { id: existingSession.id },
              data: { status: SessionStatus.EXPIRED },
            });
          }
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
   * POST /subscription/retry
   * Generates a payment method update link for failed subscriptions.
   * Use this when a subscription payment has failed and the user needs to update their payment method.
   */
  router.post(
    '/subscription/retry',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { subscription_id, customer_email, return_url } = req.body;

        if (!subscription_id && !customer_email) {
          return res.status(400).json({
            error: 'Either subscription_id or customer_email is required',
          });
        }

        let subscriptionId = subscription_id;
        let user = null;

        // If customer_email provided, find user and their failed subscription
        if (customer_email) {
          user = await getPrismaClient().userMapping.findUnique({
            where: { email: customer_email },
          });

          if (!user) {
            return res.status(404).json({ error: 'User not found' });
          }

          // Check if user has a failed subscription status or expired
          if (
            user.subscriptionStatus !== SubscriptionStatus.FAILED &&
            user.subscriptionStatus !== SubscriptionStatus.ON_HOLD &&
            user.subscriptionStatus !== SubscriptionStatus.EXPIRED
          ) {
            return res.status(400).json({
              error: 'User does not have a failed, on-hold, or expired subscription',
              current_status: user.subscriptionStatus,
            });
          }

          // If subscription is expired, create a new subscription instead of retry
          if (user.subscriptionStatus === SubscriptionStatus.EXPIRED) {
            // Find user's last subscription to get the product_id
            const lastSession = await getPrismaClient().session.findFirst({
              where: {
                userUuid: user.userUuid,
                requestedTier: { not: null },
              },
              orderBy: { createdDate: 'desc' },
            });

            if (!lastSession?.requestedTier) {
              return res.status(400).json({
                error:
                  'Cannot determine product for new subscription. No previous subscription found.',
              });
            }

            // Find product_id from tier mapping
            const envMapping =
              process.env.NODE_ENV === 'production'
                ? process.env.VITE_PROD_TIER_MAPPING
                : process.env.VITE_TEST_TIER_MAPPING;

            let productId = null;
            if (envMapping) {
              try {
                const parsed = JSON.parse(envMapping) as Record<string, string>;
                for (const [tierKey, mappedProductId] of Object.entries(parsed)) {
                  if (tierKey.startsWith(lastSession.requestedTier + '/')) {
                    productId = mappedProductId;
                    break;
                  }
                }
              } catch (error) {
                console.error('Failed to parse tier mapping:', error);
              }
            }

            if (!productId) {
              return res.status(400).json({
                error: 'Cannot determine product_id for new subscription',
              });
            }

            // Create new subscription instead of retry
            const client = DodoPaymentsService.getClient();
            const sessionData = {
              product_cart: [{ product_id: productId, quantity: 1 }],
              return_url:
                return_url ||
                process.env.CHECKOUT_RETURN_URL ||
                'http://localhost:3000/checkout/success',
              customer: user.dodoCustomerId
                ? { customer_id: user.dodoCustomerId }
                : { email: customer_email },
              metadata: {
                user_uuid: user.userUuid,
                customer_email: customer_email,
                requested_tier: lastSession.requestedTier,
              },
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const session = await client.checkoutSessions.create(sessionData as any);

            // Create session record
            await getPrismaClient().session.create({
              data: {
                sessionId: session.session_id,
                userUuid: user.userUuid,
                status: SessionStatus.PENDING,
                mode: SessionMode.SUBSCRIPTION,
                requestedTier: lastSession.requestedTier,
              },
            });

            console.log(`✅ Created new subscription for expired user ${user.userUuid}`);

            return res.json({
              success: true,
              session_url: session.checkout_url,
              session_id: session.session_id,
              message:
                'New subscription created for expired user. Redirect user to complete payment.',
            });
          }

          // Find the subscription_id from user's most recent session
          if (!subscriptionId) {
            const session = await getPrismaClient().session.findFirst({
              where: {
                userUuid: user.userUuid,
                subscriptionId: { not: null },
              },
              orderBy: { createdDate: 'desc' },
            });

            if (session?.subscriptionId) {
              subscriptionId = session.subscriptionId;
            }
          }
        }

        if (!subscriptionId) {
          return res.status(400).json({
            error: 'Could not determine subscription_id. Please provide it explicitly.',
          });
        }

        // Call DoDo API to generate update payment method link
        const client = DodoPaymentsService.getClient();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (client.subscriptions as any).updatePaymentMethod(subscriptionId, {
          type: 'new',
          return_url:
            return_url ||
            process.env.PAYMENT_UPDATE_RETURN_URL ||
            process.env.CHECKOUT_RETURN_URL ||
            'http://localhost:3000/subscription/updated',
        });

        console.log(`✅ Generated payment update link for subscription ${subscriptionId}`);

        res.json({
          success: true,
          subscription_id: subscriptionId,
          update_url: response.url || response.checkout_url || response.link,
          message:
            'Payment method update link generated. Redirect user to update their payment method.',
        });
      } catch (error) {
        console.error('❌ Error generating payment update link:', error);
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

    case 'payment.cancelled':
      await handlePaymentCancelled(data as unknown as PaymentData, payload);
      break;

    case 'payment.processing':
      await handlePaymentProcessing(data as unknown as PaymentData, payload);
      break;

    case 'dispute.opened':
      await handleDisputeOpened(data as unknown as DisputeData, payload);
      break;

    case 'refund.succeeded':
      await handleRefundSucceeded(data as unknown as RefundData, payload);
      break;

    case 'checkout.expired':
    case 'session.expired':
      await handleCheckoutExpired(data);
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

    case 'subscription.failed':
      await handleSubscriptionFailed(data as unknown as SubscriptionData, payload);
      break;

    case 'subscription.on_hold':
      await handleSubscriptionOnHold(data as unknown as SubscriptionData, payload);
      break;

    case 'subscription.plan_changed':
      await handleSubscriptionPlanChanged(data as unknown as SubscriptionData, payload);
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
  // Try multiple strategies to find the session:
  // 1. Via session_id in metadata
  // 2. Via subscription_id if this is a subscription payment
  // 3. Via user's most recent pending session
  let sessionId = data.metadata?.session_id;
  let session = null;

  if (sessionId) {
    session = await getPrismaClient().session.findFirst({
      where: { sessionId },
    });
  }

  // If no session found via metadata, try subscription_id
  if (!session && data.subscription_id) {
    session = await getPrismaClient().session.findFirst({
      where: { subscriptionId: data.subscription_id },
    });
    if (session) {
      sessionId = session.sessionId;
    }
  }

  // If still no session, find user's most recent pending session
  if (!session) {
    session = await getPrismaClient().session.findFirst({
      where: {
        userUuid: user.userUuid,
        status: SessionStatus.PENDING,
      },
      orderBy: { createdDate: 'desc' },
    });
    if (session) {
      sessionId = session.sessionId;
    }
  }

  if (session && sessionId) {
    await getPrismaClient().session.update({
      where: { id: session.id },
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

  // Update user tier and subscription status (source of truth)
  if (tier) {
    const tierConfig = data.product_cart?.[0]?.product_id
      ? getTierFromProductId(data.product_cart[0].product_id)
      : null;

    const activeLength = data.product_cart?.[0]?.product_id
      ? getActiveLengthFromProductId(data.product_cart[0].product_id)
      : null;

    // Calculate expiration based on tier config (payment webhook doesn't have expires_at)
    // The subscription.active webhook will update with actual expiration if available
    const tierExpiresAt = tierConfig ? calculateTierExpiration(tierConfig) : null;

    console.log(
      `🔍 Payment success - tier: ${tier}, activeLength: ${activeLength}, tierConfig: ${JSON.stringify(tierConfig)}, calculated expiration: ${tierExpiresAt?.toISOString()}`
    );

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: tier,
        activeLength: activeLength,
        tierExpiresAt,
        dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
        // Set subscription status to ACTIVE on successful payment
        subscriptionStatus: data.subscription_id ? SubscriptionStatus.ACTIVE : null,
      },
    });

    console.log(
      `✅ Updated user ${user.userUuid} tier to ${tier}, length: ${activeLength}, expires at ${tierExpiresAt?.toISOString()}, subscription status: ACTIVE`
    );
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
    // Use subscription_period_interval from webhook if product lookup doesn't provide activeLength
    const activeLength =
      (data.product_id ? getActiveLengthFromProductId(data.product_id) : null) ||
      data.payment_frequency_interval ||
      null;

    // Use next_billing_date or current_period_end (current billing period end), NOT expires_at (final subscription end)
    // tier_expires_at should represent when the current period ends and next payment is due
    const expiresAt = data.next_billing_date || data.current_period_end;

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: tier,
        activeLength: activeLength,
        tierExpiresAt: expiresAt
          ? new Date(expiresAt)
          : tierConfig
            ? calculateTierExpiration(tierConfig)
            : null,
      },
    });

    console.log(`✅ Updated user ${user.userUuid} tier to ${tier}, length: ${activeLength}`);
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
  _rawPayload: WebhookData
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

  // Use next_billing_date or current_period_end (current billing period end), NOT expires_at (final subscription end)
  // tier_expires_at should represent when the current period ends and next payment is due
  const expiresAt = data.next_billing_date || data.current_period_end;
  const tierConfig = data.product_id ? getTierFromProductId(data.product_id) : null;

  console.log(
    `🔍 Subscription expiration data - expires_at: ${data.expires_at}, next_billing_date: ${data.next_billing_date}, current_period_end: ${data.current_period_end}, tierConfig: ${JSON.stringify(tierConfig)}`
  );

  // Update user tier and subscription status with new period
  if (tier) {
    // Use subscription_period_interval from webhook if product lookup doesn't provide activeLength
    const activeLength =
      (data.product_id ? getActiveLengthFromProductId(data.product_id) : null) ||
      data.payment_frequency_interval ||
      null;

    // Calculate expiration: prefer DoDo's expiration date, fallback to calculated date based on tier config
    let tierExpiresAt: Date | null = null;
    if (expiresAt) {
      tierExpiresAt = new Date(expiresAt);
    } else if (tierConfig) {
      tierExpiresAt = calculateTierExpiration(tierConfig);
    }

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: tier,
        activeLength: activeLength,
        tierExpiresAt,
        dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
        // Set subscription status to ACTIVE when subscription becomes active
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      },
    });

    console.log(
      `✅ Activated subscription for user ${user.userUuid}, tier set to ${tier}, length: ${activeLength}, status: ACTIVE, expires at ${tierExpiresAt?.toISOString()}`
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

    // NOTE: We do NOT create a payment record here.
    // Payment records are created only by payment.* webhooks (payment.succeeded, payment.failed, etc.)
    // Subscription events represent subscription state changes, not financial transactions.
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
      activeLength: null,
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
      activeLength: null,
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

  // Use next_billing_date or current_period_end (current billing period end), NOT expires_at (final subscription end)
  // tier_expires_at should represent when the current period ends and next payment is due
  const expiresAt = data.next_billing_date || data.current_period_end;

  // Only update tier if subscription is active
  if (data.status === 'active' && tier) {
    // Use subscription_period_interval from webhook if product lookup doesn't provide activeLength
    const activeLength =
      (data.product_id ? getActiveLengthFromProductId(data.product_id) : null) ||
      data.payment_frequency_interval ||
      null;

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: tier,
        activeLength: activeLength,
        tierExpiresAt: expiresAt ? new Date(expiresAt) : user.tierExpiresAt,
        dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
      },
    });

    console.log(
      `✅ Updated subscription for user ${user.userUuid}, tier: ${tier}, length: ${activeLength}, expires at ${expiresAt}`
    );
  } else if (data.status === 'cancelled' || data.status === 'expired') {
    // If subscription was updated to cancelled/expired status
    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: 'FREE',
        activeLength: null,
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

  // Use next_billing_date or current_period_end (current billing period end), NOT expires_at (final subscription end)
  // tier_expires_at should represent when the current period ends and next payment is due
  const expiresAt = data.next_billing_date || data.current_period_end;

  if (tier) {
    // Use subscription_period_interval from webhook if product lookup doesn't provide activeLength
    const activeLength =
      (data.product_id ? getActiveLengthFromProductId(data.product_id) : null) ||
      data.payment_frequency_interval ||
      null;

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: tier,
        activeLength: activeLength,
        tierExpiresAt: expiresAt ? new Date(expiresAt) : user.tierExpiresAt,
        dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
        // Reset subscription status to ACTIVE on successful renewal
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      },
    });

    console.log(
      `✅ Renewed subscription for user ${user.userUuid}, tier: ${tier}, length: ${activeLength}, status: ACTIVE, new expiration: ${expiresAt}`
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

/**
 * Handle payment.cancelled webhook event
 * Fired when a payment is cancelled (e.g., due to processing errors)
 */
async function handlePaymentCancelled(data: PaymentData, rawPayload: WebhookData): Promise<void> {
  console.log('Processing payment.cancelled:', data.payment_id);

  const customerEmail = data.metadata?.customer_email || data.customer?.email;
  const userUuid = data.metadata?.user_uuid;

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
    console.error('❌ User not found for cancelled payment');
    return;
  }

  // Upsert cancelled payment record
  await getPrismaClient().payment.upsert({
    where: { dodoPaymentId: data.payment_id },
    create: {
      dodoPaymentId: data.payment_id,
      userUuid: user.userUuid,
      status: PaymentStatus.CANCELLED,
      amountCents: data.total_amount || null,
      currency: data.currency || null,
      rawJson: rawPayload as object,
    },
    update: {
      status: PaymentStatus.CANCELLED,
      rawJson: rawPayload as object,
    },
  });

  console.log(`✅ Recorded cancelled payment ${data.payment_id}`);

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
    console.log(`✅ Updated session ${sessionId} to FAILED`);
  }
}

/**
 * Handle payment.processing webhook event
 * Fired when a payment is being processed (e.g., ACH, bank transfers)
 */
async function handlePaymentProcessing(data: PaymentData, rawPayload: WebhookData): Promise<void> {
  console.log('Processing payment.processing:', data.payment_id);

  const customerEmail = data.metadata?.customer_email || data.customer?.email;
  const userUuid = data.metadata?.user_uuid;

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
    console.error('❌ User not found for processing payment');
    return;
  }

  // Determine tier from product cart or metadata
  let tier = data.metadata?.requested_tier || null;
  if (!tier && data.product_cart && data.product_cart.length > 0) {
    tier = getTierCodeFromProductId(data.product_cart[0].product_id);
  }

  // Upsert processing payment record
  await getPrismaClient().payment.upsert({
    where: { dodoPaymentId: data.payment_id },
    create: {
      dodoPaymentId: data.payment_id,
      userUuid: user.userUuid,
      status: PaymentStatus.PROCESSING,
      amountCents: data.total_amount || null,
      currency: data.currency || null,
      tier: tier,
      dodoSubscriptionId: data.subscription_id || null,
      rawJson: rawPayload as object,
    },
    update: {
      status: PaymentStatus.PROCESSING,
      rawJson: rawPayload as object,
    },
  });

  console.log(`✅ Recorded processing payment ${data.payment_id}`);
}

/**
 * Handle dispute.opened webhook event
 * Fired when a customer disputes a payment
 */
async function handleDisputeOpened(data: DisputeData, rawPayload: WebhookData): Promise<void> {
  console.log('Processing dispute.opened:', data.dispute_id, 'for payment:', data.payment_id);

  const customerEmail = data.customer?.email;

  let user;
  if (customerEmail) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { email: customerEmail },
    });
  }

  if (!user) {
    console.error('❌ User not found for dispute');
    return;
  }

  // Find and update the disputed payment
  const payment = await getPrismaClient().payment.findUnique({
    where: { dodoPaymentId: data.payment_id },
  });

  if (payment) {
    await getPrismaClient().payment.update({
      where: { dodoPaymentId: data.payment_id },
      data: {
        status: PaymentStatus.DISPUTED,
        rawJson: rawPayload as object,
      },
    });

    console.log(`✅ Marked payment ${data.payment_id} as DISPUTED`);

    // Optionally suspend user tier during dispute
    // This is a business decision - uncomment if you want to suspend access during disputes
    /*
    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        subscriptionStatus: SubscriptionStatus.ON_HOLD,
      },
    });
    console.log(`⚠️ User ${user.userUuid} subscription put on hold due to dispute`);
    */
  } else {
    // Create a record for the disputed payment if it doesn't exist
    await getPrismaClient().payment.create({
      data: {
        dodoPaymentId: data.payment_id,
        userUuid: user.userUuid,
        status: PaymentStatus.DISPUTED,
        amountCents: data.amount ? parseInt(data.amount, 10) : null,
        currency: data.currency || null,
        rawJson: rawPayload as object,
      },
    });

    console.log(`✅ Created disputed payment record for ${data.payment_id}`);
  }

  console.log(`⚠️ Dispute opened: ${data.dispute_id}, reason: ${data.reason}`);
}

/**
 * Handle refund.succeeded webhook event
 * Fired when a refund is successfully processed
 */
async function handleRefundSucceeded(data: RefundData, rawPayload: WebhookData): Promise<void> {
  console.log('Processing refund.succeeded:', data.refund_id, 'for payment:', data.payment_id);

  const customerEmail = data.customer?.email;

  let user;
  if (customerEmail) {
    user = await getPrismaClient().userMapping.findUnique({
      where: { email: customerEmail },
    });
  }

  if (!user) {
    console.error('❌ User not found for refund');
    return;
  }

  // Find and update the refunded payment
  const payment = await getPrismaClient().payment.findUnique({
    where: { dodoPaymentId: data.payment_id },
  });

  if (payment) {
    await getPrismaClient().payment.update({
      where: { dodoPaymentId: data.payment_id },
      data: {
        status: PaymentStatus.REFUNDED,
        rawJson: rawPayload as object,
      },
    });

    console.log(`✅ Marked payment ${data.payment_id} as REFUNDED`);

    // For full refunds, revoke the tier
    if (!data.is_partial) {
      await getPrismaClient().userMapping.update({
        where: { userUuid: user.userUuid },
        data: {
          activeTier: 'FREE',
          activeLength: null,
          tierExpiresAt: new Date(),
          subscriptionStatus: null,
        },
      });

      console.log(`✅ Full refund processed - user ${user.userUuid} tier reverted to FREE`);
    } else {
      console.log(`✅ Partial refund processed for user ${user.userUuid} - tier unchanged`);
    }
  } else {
    // Create a refund record if original payment doesn't exist
    await getPrismaClient().payment.create({
      data: {
        dodoPaymentId: `refund_${data.refund_id}`,
        userUuid: user.userUuid,
        status: PaymentStatus.REFUNDED,
        amountCents: data.amount ? -data.amount : null, // Negative to indicate refund
        currency: data.currency || null,
        rawJson: rawPayload as object,
      },
    });

    console.log(`✅ Created refund record for ${data.refund_id}`);
  }
}

/**
 * Handle subscription.failed webhook event
 * Fired when a subscription payment fails (e.g., card declined during renewal)
 */
async function handleSubscriptionFailed(
  data: SubscriptionData,
  _rawPayload: WebhookData
): Promise<void> {
  console.log('Processing subscription.failed:', data.subscription_id);

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
    console.error('❌ User not found for failed subscription');
    return;
  }

  // Check if user is in GRACE, CANCELLED, or EXPIRED status - if so, don't update subscription status
  if (
    user.subscriptionStatus === SubscriptionStatus.GRACE ||
    user.subscriptionStatus === SubscriptionStatus.CANCELLED ||
    user.subscriptionStatus === SubscriptionStatus.EXPIRED
  ) {
    console.log(
      `⚠️ User ${user.userUuid} is in ${user.subscriptionStatus} status, skipping subscription failure update`
    );
    return;
  }

  // Update user's subscription status to FAILED
  await getPrismaClient().userMapping.update({
    where: { userUuid: user.userUuid },
    data: {
      subscriptionStatus: SubscriptionStatus.FAILED,
      // Keep the current tier for now - give grace period
      // Tier will be revoked when subscription expires or after grace period
    },
  });

  console.log(`⚠️ Subscription failed for user ${user.userUuid}`);

  // NOTE: We do NOT create a payment record here.
  // Failed payment attempts are recorded via payment.failed webhooks.
  // This handler only updates subscription state.
}

/**
 * Handle subscription.on_hold webhook event
 * Fired when a subscription is put on hold (e.g., payment issue pending resolution)
 */
async function handleSubscriptionOnHold(
  data: SubscriptionData,
  _rawPayload: WebhookData
): Promise<void> {
  console.log('Processing subscription.on_hold:', data.subscription_id);

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
    console.error('❌ User not found for on_hold subscription');
    return;
  }

  // Check if user is in GRACE, CANCELLED, or EXPIRED status - if so, don't update subscription status
  if (
    user.subscriptionStatus === SubscriptionStatus.GRACE ||
    user.subscriptionStatus === SubscriptionStatus.CANCELLED ||
    user.subscriptionStatus === SubscriptionStatus.EXPIRED
  ) {
    console.log(
      `⚠️ User ${user.userUuid} is in ${user.subscriptionStatus} status, skipping on_hold update`
    );
    return;
  }

  // Update user's subscription status to ON_HOLD
  // Keep the tier active during grace period
  await getPrismaClient().userMapping.update({
    where: { userUuid: user.userUuid },
    data: {
      subscriptionStatus: SubscriptionStatus.ON_HOLD,
      // Keep activeTier as is - user retains access during hold period
    },
  });

  console.log(`⚠️ Subscription on hold for user ${user.userUuid}`);

  // Update session if exists
  const existingSession = await getPrismaClient().session.findFirst({
    where: { subscriptionId: data.subscription_id },
  });

  if (existingSession) {
    await getPrismaClient().session.update({
      where: { id: existingSession.id },
      data: {
        status: SessionStatus.PENDING, // Mark as pending since subscription is on hold
      },
    });
    console.log(`✅ Updated session ${existingSession.sessionId} to PENDING (on hold)`);
  }
}

/**
 * Handle subscription.plan_changed webhook event
 * Fired when a subscription plan is upgraded or downgraded
 */
async function handleSubscriptionPlanChanged(
  data: SubscriptionData,
  rawPayload: WebhookData
): Promise<void> {
  console.log('Processing subscription.plan_changed:', data.subscription_id);

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
    console.error('❌ User not found for plan change');
    return;
  }

  // Determine the new tier from the new product_id
  const newTier = data.product_id ? getTierCodeFromProductId(data.product_id) : null;
  const tierConfig = data.product_id ? getTierFromProductId(data.product_id) : null;

  // Use next_billing_date or current_period_end (current billing period end), NOT expires_at (final subscription end)
  // tier_expires_at should represent when the current period ends and next payment is due
  const expiresAt = data.next_billing_date || data.current_period_end;

  if (newTier) {
    const oldTier = user.activeTier;
    // Use subscription_period_interval from webhook if product lookup doesn't provide activeLength
    const activeLength =
      (data.product_id ? getActiveLengthFromProductId(data.product_id) : null) ||
      data.payment_frequency_interval ||
      null;

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        activeTier: newTier,
        activeLength: activeLength,
        tierExpiresAt: expiresAt
          ? new Date(expiresAt)
          : tierConfig
            ? calculateTierExpiration(tierConfig)
            : user.tierExpiresAt,
        subscriptionStatus:
          data.status === 'active' ? SubscriptionStatus.ACTIVE : user.subscriptionStatus,
        dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
      },
    });

    console.log(
      `✅ Plan changed for user ${user.userUuid}: ${oldTier} → ${newTier}, length: ${activeLength}, expires at ${expiresAt}`
    );
  } else {
    console.log(
      `⚠️ Plan changed but could not determine new tier from product_id: ${data.product_id}`
    );
  }

  // Update session if exists
  const existingSession = await getPrismaClient().session.findFirst({
    where: { subscriptionId: data.subscription_id },
  });

  if (existingSession) {
    await getPrismaClient().session.update({
      where: { id: existingSession.id },
      data: {
        requestedTier: newTier || existingSession.requestedTier,
        expiresAt: expiresAt ? new Date(expiresAt) : existingSession.expiresAt,
      },
    });
    console.log(`✅ Updated session ${existingSession.sessionId} with new tier ${newTier}`);
  }

  // Log the plan change for audit purposes
  console.log('Plan change details:', JSON.stringify(rawPayload, null, 2));
}

/**
 * Handle checkout.expired / session.expired webhook event
 * Fired when a checkout session expires (e.g., user didn't complete payment, card registration failed)
 */
async function handleCheckoutExpired(data: Record<string, unknown>): Promise<void> {
  const sessionId = data.session_id as string;

  if (!sessionId) {
    console.error('❌ No session_id in checkout expired event');
    return;
  }

  console.log('Processing checkout/session expired:', sessionId);

  const result = await getPrismaClient().session.updateMany({
    where: { sessionId },
    data: { status: SessionStatus.EXPIRED },
  });

  if (result.count > 0) {
    console.log(`✅ Marked session ${sessionId} as EXPIRED`);
  } else {
    console.log(`⚠️ Session ${sessionId} not found in database`);
  }
}
