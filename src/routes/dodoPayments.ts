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
import {
  determineChangeType,
  SubscriptionChangeType,
  getChangeTypeDescription,
  normalizeBillingFrequency,
} from '../utils/tierComparison';
import crypto from 'crypto';
import {
  SessionStatus,
  PaymentStatus,
  SessionMode,
  SubscriptionStatus,
  PlanChangeStatus,
} from '@prisma/client';

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

          // If subscription is CANCELLED, user needs to subscribe again (not retry)
          if (user.subscriptionStatus === SubscriptionStatus.CANCELLED) {
            return res.status(400).json({
              error:
                'Your subscription has been cancelled. Please subscribe again to continue using the service.',
              current_status: user.subscriptionStatus,
              action_required: 'subscribe',
            });
          }

          // Block retry if subscription is ON_HOLD - payment is being processed
          if (user.subscriptionStatus === SubscriptionStatus.ON_HOLD) {
            return res.status(409).json({
              error:
                'Cannot retry - subscription is on hold. Please wait for the current payment to be processed.',
              current_status: user.subscriptionStatus,
            });
          }

          // Check for any PROCESSING payments - block retry if payment is in progress
          const processingPayment = await getPrismaClient().payment.findFirst({
            where: {
              userUuid: user.userUuid,
              status: PaymentStatus.PROCESSING,
            },
            orderBy: { createdAt: 'desc' },
          });

          if (processingPayment) {
            return res.status(409).json({
              error:
                'Cannot retry - a payment is currently being processed. Please wait for it to complete.',
              current_status: user.subscriptionStatus,
              processing_payment: {
                id: processingPayment.dodoPaymentId,
                createdAt: processingPayment.createdAt?.toISOString(),
              },
            });
          }

          // Allow retry when subscription is ACTIVE or FAILED
          // ACTIVE: User may want to retry a failed plan change payment
          // FAILED: Subscription payment failed
          const canRetry =
            user.subscriptionStatus === SubscriptionStatus.ACTIVE ||
            user.subscriptionStatus === SubscriptionStatus.FAILED ||
            user.subscriptionStatus === SubscriptionStatus.EXPIRED;

          const hasPendingPlanChange =
            user.planChangeStatus === PlanChangeStatus.PENDING ||
            user.planChangeStatus === PlanChangeStatus.PAYMENT_NEEDED;

          if (!canRetry && !hasPendingPlanChange) {
            return res.status(400).json({
              error:
                'User does not have an active or failed subscription, nor a pending plan change requiring payment',
              current_status: user.subscriptionStatus,
              plan_change_status: user.planChangeStatus,
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

          // Use subscriptionId stored directly on user
          if (!subscriptionId && user.subscriptionId) {
            subscriptionId = user.subscriptionId;
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
        console.log('📦 DoDo updatePaymentMethod response:', JSON.stringify(response, null, 2));

        res.json({
          success: true,
          subscription_id: subscriptionId,
          update_url:
            response.payment_link || response.url || response.checkout_url || response.link,
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
   * POST /subscription/cancel
   * Cancels a subscription by setting it to end at the next billing date.
   * Uses DoDo Payments Update Subscription API with cancel_at_next_billing_date flag.
   */
  router.post(
    '/subscription/cancel',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { subscription_id, customer_email } = req.body;

        if (!subscription_id && !customer_email) {
          return res.status(400).json({
            error: 'Either subscription_id or customer_email is required',
          });
        }

        let subscriptionId = subscription_id;
        let user = null;

        // If customer_email provided, find user and their active subscription
        if (customer_email) {
          user = await getPrismaClient().userMapping.findUnique({
            where: { email: customer_email },
          });

          if (!user) {
            return res.status(404).json({ error: 'User not found' });
          }

          // Check if user has an active subscription
          if (
            user.subscriptionStatus !== SubscriptionStatus.ACTIVE &&
            user.subscriptionStatus !== SubscriptionStatus.GRACE
          ) {
            return res.status(400).json({
              error: 'User does not have an active subscription to cancel',
              current_status: user.subscriptionStatus,
            });
          }

          // Use subscriptionId stored directly on user
          if (!subscriptionId && user.subscriptionId) {
            subscriptionId = user.subscriptionId;
          }
        }

        if (!subscriptionId) {
          return res.status(400).json({
            error: 'Could not determine subscription_id. Please provide it explicitly.',
          });
        }

        // Call DoDo API to cancel subscription at next billing date
        const client = DodoPaymentsService.getClient();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (client.subscriptions as any).update(subscriptionId, {
          cancel_at_next_billing_date: true,
        });

        // Update local user status to CANCELLED
        if (user) {
          await getPrismaClient().userMapping.update({
            where: { userUuid: user.userUuid },
            data: {
              subscriptionStatus: SubscriptionStatus.CANCELLED,
            },
          });
        } else if (customer_email) {
          // If we only had subscription_id, try to find and update the user
          const session = await getPrismaClient().session.findFirst({
            where: { subscriptionId: subscriptionId },
          });
          if (session) {
            await getPrismaClient().userMapping.update({
              where: { userUuid: session.userUuid },
              data: {
                subscriptionStatus: SubscriptionStatus.CANCELLED,
              },
            });
          }
        }

        console.log(
          `✅ Subscription ${subscriptionId} marked for cancellation at next billing date`
        );

        res.json({
          success: true,
          subscription_id: subscriptionId,
          message:
            'Subscription will be cancelled at the next billing date. User will retain access until then.',
          cancellation_details: response,
        });
      } catch (error) {
        console.error('❌ Error cancelling subscription:', error);
        next(error);
      }
    }
  );

  /**
   * GET /subscription/plan-change-status
   * Get the current plan change status for a user.
   * Returns the status of any pending, completed, or failed plan changes.
   */
  router.get(
    '/subscription/plan-change-status',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const customer_email = req.query.customer_email as string;

        if (!customer_email) {
          return res.status(400).json({ error: 'customer_email query parameter is required' });
        }

        const user = await getPrismaClient().userMapping.findUnique({
          where: { email: customer_email },
        });

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Build response based on plan change status
        const response: {
          success: boolean;
          plan_change_status: string | null;
          current_plan: {
            tier: string | null;
            activeLength: string | null;
            expiresAt: string | null;
          };
          pending_change: {
            tier: string | null;
            activeLength: string | null;
            effectiveDate: string | null;
            changeType: string | null;
            productId: string | null;
            initiatedAt: string | null;
          } | null;
          message: string;
        } = {
          success: true,
          plan_change_status: user.planChangeStatus || null,
          current_plan: {
            tier: user.activeTier,
            activeLength: user.activeLength,
            expiresAt: user.tierExpiresAt?.toISOString() || null,
          },
          pending_change: null,
          message: '',
        };

        // Add pending change info if exists
        if (user.pendingTier) {
          response.pending_change = {
            tier: user.pendingTier,
            activeLength: user.pendingActiveLength,
            effectiveDate: user.pendingTierEffectiveDate?.toISOString() || null,
            changeType: user.pendingChangeType,
            productId: user.pendingProductId || null,
            initiatedAt: user.planChangeInitiatedAt?.toISOString() || null,
          };
        }

        // Set message based on status
        switch (user.planChangeStatus) {
          case 'PENDING':
            response.message = 'Plan change is pending payment confirmation.';
            break;
          case 'COMPLETED':
            response.message = user.pendingTier
              ? 'Plan change completed. Scheduled change will take effect at the end of billing cycle.'
              : 'No pending plan changes.';
            break;
          case 'PAYMENT_NEEDED':
            response.message =
              'Payment failed or on hold. Please update your payment method to complete the plan change.';
            break;
          default:
            response.message = user.pendingTier
              ? 'There is a scheduled plan change.'
              : 'No pending plan changes.';
        }

        res.json(response);
      } catch (error) {
        console.error('❌ Error getting plan change status:', error);
        next(error);
      }
    }
  );

  /**
   * POST /subscription/cancel-pending-change
   * Cancels a scheduled tier change (downgrade or frequency change).
   * Only applicable if there's a pending change that hasn't taken effect yet.
   */
  router.post(
    '/subscription/cancel-pending-change',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { customer_email } = req.body;

        if (!customer_email) {
          return res.status(400).json({ error: 'customer_email is required' });
        }

        const user = await getPrismaClient().userMapping.findUnique({
          where: { email: customer_email },
        });

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        if (!user.pendingTier && !user.planChangeStatus) {
          return res.status(400).json({
            error: 'No pending change to cancel',
            current_tier: user.activeTier,
          });
        }

        const cancelledChange = {
          tier: user.pendingTier,
          activeLength: user.pendingActiveLength,
          effectiveDate: user.pendingTierEffectiveDate?.toISOString(),
          changeType: user.pendingChangeType,
          status: user.planChangeStatus,
        };

        // Clear ALL pending change fields including new ones
        await getPrismaClient().userMapping.update({
          where: { email: customer_email },
          data: {
            planChangeStatus: null,
            pendingTier: null,
            pendingActiveLength: null,
            pendingTierEffectiveDate: null,
            pendingChangeType: null,
            pendingProductId: null,
            planChangeInitiatedAt: null,
          },
        });

        console.log(`✅ Cancelled pending change for user ${user.userUuid}:`, cancelledChange);

        res.json({
          success: true,
          message: 'Pending change cancelled successfully',
          cancelled_change: cancelledChange,
          current_tier: user.activeTier,
          current_length: user.activeLength,
        });
      } catch (error) {
        console.error('❌ Error cancelling pending change:', error);
        next(error);
      }
    }
  );

  /**
   * POST /subscription/preview-change
   * Preview what a plan change would look like before committing.
   * Returns proration details and the type of change (upgrade/downgrade/frequency).
   */
  router.post(
    '/subscription/preview-change',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { customer_email, product_id } = req.body;

        if (!customer_email) {
          return res.status(400).json({ error: 'customer_email is required' });
        }

        if (!product_id) {
          return res.status(400).json({ error: 'product_id is required' });
        }

        const user = await getPrismaClient().userMapping.findUnique({
          where: { email: customer_email },
        });

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Use subscriptionId directly from user record
        if (!user.subscriptionId) {
          return res.status(400).json({
            error: 'No active subscription found for this user',
          });
        }

        // Determine what type of change this would be
        const newTier = getTierCodeFromProductId(product_id);
        const newLength = getActiveLengthFromProductId(product_id);

        if (!newTier) {
          return res.status(400).json({
            error: 'Invalid product_id - could not determine tier',
          });
        }

        const changeType = determineChangeType(
          user.activeTier,
          newTier,
          user.activeLength,
          newLength
        );

        // Call DoDo API to preview the change
        const client = DodoPaymentsService.getClient();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const previewResponse = await (client.subscriptions as any).previewChangePlan(
          user.subscriptionId,
          {
            product_id: product_id,
            proration_billing_mode: 'prorated_immediately',
            quantity: 1,
          }
        );

        console.log(`✅ Preview change for user ${user.userUuid}: ${user.activeTier} → ${newTier}`);

        res.json({
          success: true,
          current: {
            tier: user.activeTier,
            activeLength: user.activeLength,
            expiresAt: user.tierExpiresAt?.toISOString(),
          },
          proposed: {
            tier: newTier,
            activeLength: newLength,
          },
          change_type: changeType,
          change_description: getChangeTypeDescription(changeType),
          is_immediate: changeType === 'IMMEDIATE_UPGRADE',
          effective_date:
            changeType === 'IMMEDIATE_UPGRADE'
              ? new Date().toISOString()
              : user.tierExpiresAt?.toISOString(),
          proration_details: previewResponse,
        });
      } catch (error) {
        console.error('❌ Error previewing plan change:', error);
        next(error);
      }
    }
  );

  /**
   * POST /subscription/change-plan
   * Changes the subscription plan (upgrade, downgrade, or frequency change).
   *
   * NEW FLOW:
   * 1. Initiate plan change with DoDo using difference_immediately proration
   * 2. Store pending plan change in DB with status PENDING
   * 3. Wait for payment.succeeded webhook to mark as COMPLETED and update user tier
   * 4. If payment fails/on-hold, mark as PAYMENT_NEEDED for follow-up
   *
   * This ensures we NEVER give access before payment is confirmed.
   */
  router.post(
    '/subscription/change-plan',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { customer_email, product_id } = req.body;

        if (!customer_email) {
          return res.status(400).json({ error: 'customer_email is required' });
        }

        if (!product_id) {
          return res.status(400).json({ error: 'product_id is required' });
        }

        // Find user
        const user = await getPrismaClient().userMapping.findUnique({
          where: { email: customer_email },
        });

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Use subscriptionId directly from user record
        if (!user.subscriptionId) {
          return res.status(400).json({
            error: 'No active subscription found for this user',
          });
        }

        const subscriptionId = user.subscriptionId;

        // Check for pending payments - don't allow new plan changes if there's a pending payment
        const pendingPayment = await getPrismaClient().payment.findFirst({
          where: {
            userUuid: user.userUuid,
            status: {
              in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING],
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (pendingPayment) {
          return res.status(409).json({
            success: false,
            error: 'pending_payment_exists',
            message:
              'Cannot change plan while a payment is pending. Please wait for the current payment to complete.',
            pending_payment: {
              id: pendingPayment.dodoPaymentId,
              status: pendingPayment.status,
              createdAt: pendingPayment.createdAt?.toISOString(),
            },
          });
        }

        // Also check if there's already a pending plan change
        if (user.planChangeStatus === PlanChangeStatus.PENDING) {
          return res.status(409).json({
            success: false,
            error: 'pending_plan_change_exists',
            message: 'A plan change is already in progress. Please wait for it to complete.',
            pending_change: {
              tier: user.pendingTier,
              activeLength: user.pendingActiveLength,
              changeType: user.pendingChangeType,
              initiatedAt: user.planChangeInitiatedAt?.toISOString(),
            },
          });
        }

        // Determine what type of change this would be
        const newTier = getTierCodeFromProductId(product_id);
        const newLength = getActiveLengthFromProductId(product_id);

        if (!newTier) {
          return res.status(400).json({
            error: 'Invalid product_id - could not determine tier',
          });
        }

        const changeType = determineChangeType(
          user.activeTier,
          newTier,
          user.activeLength,
          newLength
        );

        // If no actual change, return early
        if (changeType === 'NO_CHANGE') {
          return res.json({
            success: true,
            message: 'No plan change needed - you are already on this plan.',
            plan_change_status: null,
            current: {
              tier: user.activeTier,
              activeLength: user.activeLength,
            },
          });
        }

        // Call DoDo API to change the plan
        // ALWAYS use difference_immediately for proration - this charges immediately
        const client = DodoPaymentsService.getClient();

        console.log(
          `📋 Initiating plan change for user ${user.userUuid}: ${user.activeTier} → ${newTier}`
        );
        console.log(`📋 Using proration_billing_mode: difference_immediately`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const changeResponse = await (client.subscriptions as any).changePlan(subscriptionId, {
          product_id: product_id,
          proration_billing_mode: 'difference_immediately',
          quantity: 1,
        });

        console.log('DoDo changePlan response:', JSON.stringify(changeResponse, null, 2));

        // With difference_immediately, DoDo charges the card on file automatically
        // We do NOT generate payment links - we wait for payment.succeeded webhook
        // The card on file will be charged, and if it fails, payment.failed webhook handles it

        // Store the pending plan change in the database
        // Status is PENDING until payment.succeeded webhook confirms it
        await getPrismaClient().userMapping.update({
          where: { userUuid: user.userUuid },
          data: {
            planChangeStatus: PlanChangeStatus.PENDING,
            pendingTier: newTier,
            pendingActiveLength: newLength,
            pendingTierEffectiveDate:
              changeType === 'IMMEDIATE_UPGRADE' ? new Date() : user.tierExpiresAt,
            pendingChangeType: changeType,
            pendingProductId: product_id,
            planChangeInitiatedAt: new Date(),
          },
        });

        console.log(`✅ Plan change initiated and stored as PENDING for user ${user.userUuid}`);

        res.json({
          success: true,
          message: 'Plan change initiated. Waiting for payment confirmation.',
          plan_change_status: 'PENDING',
          subscription_id: subscriptionId,
          change_type: changeType,
          change_description: getChangeTypeDescription(changeType),
          current: {
            tier: user.activeTier,
            activeLength: user.activeLength,
          },
          new: {
            tier: newTier,
            activeLength: newLength,
          },
          effective_date:
            changeType === 'IMMEDIATE_UPGRADE'
              ? new Date().toISOString()
              : user.tierExpiresAt?.toISOString(),
          note:
            changeType === 'IMMEDIATE_UPGRADE'
              ? 'Your card on file will be charged automatically. Tier will update upon payment confirmation.'
              : 'Change will take effect at end of current billing cycle.',
        });
      } catch (error) {
        console.error('❌ Error changing plan:', error);

        // Handle specific DoDo Payments errors
        if (error instanceof Error && 'status' in error) {
          const apiError = error as { status: number; error?: { code?: string; message?: string } };

          if (apiError.status === 409 && apiError.error?.code === 'PREVIOUS_PAYMENT_PENDING') {
            // There's already a pending payment - DoDo will automatically retry charging the card
            // We do NOT generate new payment links - just inform the user to wait
            const { customer_email } = req.body;

            const user = await getPrismaClient().userMapping.findUnique({
              where: { email: customer_email },
            });

            if (!user) {
              return res.status(404).json({ error: 'User not found' });
            }

            // If there's already a pending plan change, return that info
            if (user.planChangeStatus === PlanChangeStatus.PENDING) {
              return res.json({
                success: true,
                message:
                  'A plan change is already pending. Your card on file will be charged automatically.',
                plan_change_status: 'PENDING',
                pending_change: {
                  tier: user.pendingTier,
                  activeLength: user.pendingActiveLength,
                  changeType: user.pendingChangeType,
                  initiatedAt: user.planChangeInitiatedAt?.toISOString(),
                },
                current: {
                  tier: user.activeTier,
                  activeLength: user.activeLength,
                },
                note: 'Payment will be processed automatically. Tier will update upon payment confirmation.',
              });
            }

            // No pending plan change in our DB but DoDo says payment pending
            // This means DoDo is still processing - tell user to wait
            return res.json({
              success: true,
              message:
                'A payment is being processed. Please wait for automatic payment confirmation.',
              plan_change_status: 'PROCESSING',
              current: {
                tier: user.activeTier,
                activeLength: user.activeLength,
              },
              note: 'Your card on file is being charged. You will receive confirmation once payment completes.',
            });
          }
        }

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
 *
 * NEW FLOW for plan changes:
 * 1. If user has planChangeStatus = PENDING, this payment confirms the plan change
 * 2. Update planChangeStatus to COMPLETED
 * 3. Apply the pending tier change to activeTier
 * 4. Clear all pending fields
 *
 * This ensures we NEVER give access before payment is confirmed.
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
    paymentLink: data.payment_link || null,
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
  let sessionId = data.metadata?.session_id;
  let session = null;

  if (sessionId) {
    session = await getPrismaClient().session.findFirst({
      where: { sessionId },
    });
  }

  if (!session && data.subscription_id) {
    session = await getPrismaClient().session.findFirst({
      where: { subscriptionId: data.subscription_id },
    });
    if (session) {
      sessionId = session.sessionId;
    }
  }

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

    await getPrismaClient().payment.update({
      where: { dodoPaymentId: data.payment_id },
      data: { sessionId },
    });
  }

  // Re-fetch user to get latest pending change info
  const freshUser = await getPrismaClient().userMapping.findUnique({
    where: { userUuid: user.userUuid },
  });

  // ============================================================
  // PLAN CHANGE FLOW: Only mark status as COMPLETED
  // The subscription webhooks (subscription.updated, subscription.plan_changed)
  // will handle updating the actual tier based on the new product_id
  // ============================================================
  if (freshUser?.planChangeStatus === PlanChangeStatus.PENDING) {
    console.log(`🎉 PLAN CHANGE PAYMENT SUCCEEDED for user ${user.userUuid}`);
    console.log(`   Pending change: ${freshUser.activeTier} → ${freshUser.pendingTier}`);
    console.log(`   Change type: ${freshUser.pendingChangeType}`);
    console.log(`   ⏳ Marking as COMPLETED - subscription webhook will update the tier`);

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        // Mark plan change as COMPLETED - subscription webhook will apply the new tier
        planChangeStatus: PlanChangeStatus.COMPLETED,
        dodoCustomerId: data.customer?.customer_id || freshUser.dodoCustomerId,
        // Store subscriptionId if available
        subscriptionId: data.subscription_id || freshUser.subscriptionId,
      },
    });

    console.log(`✅ Plan change marked as COMPLETED for user ${user.userUuid}`);
    return;
  }

  // ============================================================
  // STANDARD FLOW: Update basic fields only
  // Let subscription webhooks handle tier updates
  // ============================================================
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {
    dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
  };

  // Store subscriptionId on user if available
  if (data.subscription_id) {
    updateData.subscriptionId = data.subscription_id;
  }

  await getPrismaClient().userMapping.update({
    where: { userUuid: user.userUuid },
    data: updateData,
  });

  console.log(
    `✅ Payment succeeded for user ${user.userUuid} - subscription webhooks will handle tier updates`
  );
}

/**
 * Handle payment.failed webhook event
 *
 * NEW FLOW for plan changes:
 * If user has planChangeStatus = PENDING, mark it as PAYMENT_NEEDED
 * This allows us to notify the user to update their payment method
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

  // ============================================================
  // NEW PLAN CHANGE FLOW: If there's a pending plan change, mark as PAYMENT_NEEDED
  // ============================================================
  // Re-fetch user to get latest data
  const freshUser = await getPrismaClient().userMapping.findUnique({
    where: { userUuid: user.userUuid },
  });

  if (freshUser?.planChangeStatus === PlanChangeStatus.PENDING) {
    console.log(`⚠️ Plan change payment FAILED for user ${user.userUuid}`);
    console.log(`   Marking plan change as PAYMENT_NEEDED`);
    console.log(`   Pending tier: ${freshUser.pendingTier}`);

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: {
        planChangeStatus: PlanChangeStatus.PAYMENT_NEEDED,
        // Keep pending fields so we know what they were trying to change to
        // User can retry the payment to complete the plan change
      },
    });

    console.log(`✅ Plan change marked as PAYMENT_NEEDED for user ${user.userUuid}`);
  }

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

  // Determine tier
  let tier = data.metadata?.requested_tier || null;
  if (!tier && data.product_id) {
    tier = getTierCodeFromProductId(data.product_id);
  }

  // Build update data - always store subscriptionId and customerId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {
    subscriptionId: data.subscription_id,
    dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
  };

  // Update user tier with subscription period if active
  if (tier && data.status === 'active') {
    const tierConfig = data.product_id ? getTierFromProductId(data.product_id) : null;
    const activeLength =
      (data.product_id ? getActiveLengthFromProductId(data.product_id) : null) ||
      normalizeBillingFrequency(data.payment_frequency_interval ?? null) ||
      null;

    const expiresAt = data.next_billing_date || data.current_period_end;

    updateData.activeTier = tier;
    updateData.activeLength = activeLength;
    updateData.tierExpiresAt = expiresAt
      ? new Date(expiresAt)
      : tierConfig
        ? calculateTierExpiration(tierConfig)
        : null;
  }

  await getPrismaClient().userMapping.update({
    where: { userUuid: user.userUuid },
    data: updateData,
  });

  console.log(
    `✅ Updated user ${user.userUuid} with subscription ${data.subscription_id}, tier: ${tier || '(unchanged)'}`
  );

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

  // Determine tier
  let tier = data.metadata?.requested_tier || null;
  if (!tier && data.product_id) {
    tier = getTierCodeFromProductId(data.product_id);
  }

  // Use next_billing_date or current_period_end (current billing period end)
  const expiresAt = data.next_billing_date || data.current_period_end;
  const tierConfig = data.product_id ? getTierFromProductId(data.product_id) : null;

  console.log(
    `🔍 Subscription expiration data - expires_at: ${data.expires_at}, next_billing_date: ${data.next_billing_date}, current_period_end: ${data.current_period_end}`
  );

  // Build update data - always store subscriptionId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {
    subscriptionId: data.subscription_id,
    dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
    subscriptionStatus: SubscriptionStatus.ACTIVE,
  };

  // Update user tier and subscription status with new period
  if (tier) {
    const activeLength =
      (data.product_id ? getActiveLengthFromProductId(data.product_id) : null) ||
      normalizeBillingFrequency(data.payment_frequency_interval ?? null) ||
      null;

    let tierExpiresAt: Date | null = null;
    if (expiresAt) {
      tierExpiresAt = new Date(expiresAt);
    } else if (tierConfig) {
      tierExpiresAt = calculateTierExpiration(tierConfig);
    }

    updateData.activeTier = tier;
    updateData.activeLength = activeLength;
    updateData.tierExpiresAt = tierExpiresAt;
  }

  await getPrismaClient().userMapping.update({
    where: { userUuid: user.userUuid },
    data: updateData,
  });

  console.log(
    `✅ Activated subscription ${data.subscription_id} for user ${user.userUuid}, tier: ${tier || '(unchanged)'}, status: ACTIVE`
  );

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

  // Use next_billing_date or current_period_end (current billing period end), NOT expires_at (final subscription end)
  // tier_expires_at should represent when the current period ends and next payment is due
  const expiresAt = data.next_billing_date || data.current_period_end;

  // Determine tier from product_id (source of truth) - fallback to metadata only if no product_id
  // IMPORTANT: product_id reflects the CURRENT plan, metadata.requested_tier may be stale after plan changes
  const tier = data.product_id
    ? getTierCodeFromProductId(data.product_id)
    : data.metadata?.requested_tier || null;

  // Only update tier if subscription is active
  if (data.status === 'active' && tier) {
    // Re-fetch user to get latest state (plan change might have just been completed)
    const freshUser = await getPrismaClient().userMapping.findUnique({
      where: { userUuid: user.userUuid },
    });

    // IMPORTANT: If a plan change is PENDING (payment not confirmed), skip tier update
    // to avoid overwriting with old product_id before payment completes
    if (freshUser?.planChangeStatus === PlanChangeStatus.PENDING) {
      console.log(
        `⏭️ Skipping tier update in subscription.updated - plan change is PENDING (awaiting payment)`
      );
      console.log(`   Current tier: ${freshUser.activeTier}, webhook product tier: ${tier}`);

      // Only update non-tier fields like tierExpiresAt and dodoCustomerId
      await getPrismaClient().userMapping.update({
        where: { userUuid: user.userUuid },
        data: {
          tierExpiresAt: expiresAt ? new Date(expiresAt) : freshUser.tierExpiresAt,
          dodoCustomerId: data.customer?.customer_id || freshUser.dodoCustomerId,
        },
      });
      return;
    }

    // If plan change is COMPLETED, this webhook has the NEW product_id - apply tier and clear pending fields
    const shouldClearPlanChange = freshUser?.planChangeStatus === PlanChangeStatus.COMPLETED;

    // Use subscription_period_interval from webhook if product lookup doesn't provide activeLength
    // Normalize frequency - DoDo uses "Month"/"Year", we use "MONTHLY"/"YEARLY"
    const activeLength =
      (data.product_id ? getActiveLengthFromProductId(data.product_id) : null) ||
      normalizeBillingFrequency(data.payment_frequency_interval ?? null) ||
      null;

    // Build update data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      activeTier: tier,
      activeLength: activeLength,
      tierExpiresAt: expiresAt ? new Date(expiresAt) : user.tierExpiresAt,
      dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
    };

    // If plan change was COMPLETED, clear all the pending fields
    if (shouldClearPlanChange) {
      console.log(`🎉 Applying plan change - clearing pending fields after COMPLETED status`);
      updateData.planChangeStatus = null;
      updateData.pendingTier = null;
      updateData.pendingActiveLength = null;
      updateData.pendingTierEffectiveDate = null;
      updateData.pendingChangeType = null;
      updateData.pendingProductId = null;
      updateData.planChangeInitiatedAt = null;
    }

    await getPrismaClient().userMapping.update({
      where: { userUuid: user.userUuid },
      data: updateData,
    });

    console.log(
      `✅ Updated subscription for user ${user.userUuid}, tier: ${tier}, length: ${activeLength}, expires at ${expiresAt}${shouldClearPlanChange ? ' (plan change completed)' : ''}`
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
 *
 * Important: This is where pending tier changes (downgrades/frequency changes) are applied.
 * When a subscription renews, any pending changes take effect.
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

  // Use next_billing_date or current_period_end (current billing period end)
  const expiresAt = data.next_billing_date || data.current_period_end;

  // Check for pending tier changes to apply on renewal
  if (user.pendingTier && user.pendingTierEffectiveDate) {
    const now = new Date();
    // Apply pending change if the effective date has passed or is now
    if (user.pendingTierEffectiveDate <= now) {
      console.log(
        `📅 Applying pending tier change on renewal: ${user.activeTier} → ${user.pendingTier}`
      );

      await getPrismaClient().userMapping.update({
        where: { userUuid: user.userUuid },
        data: {
          activeTier: user.pendingTier,
          activeLength: user.pendingActiveLength,
          tierExpiresAt: expiresAt ? new Date(expiresAt) : user.tierExpiresAt,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
          // Clear pending fields after applying
          pendingTier: null,
          pendingActiveLength: null,
          pendingTierEffectiveDate: null,
          pendingChangeType: null,
        },
      });

      console.log(
        `✅ Applied pending change for user ${user.userUuid}: now on ${user.pendingTier}/${user.pendingActiveLength}, expires: ${expiresAt}`
      );

      // Update session if exists
      const existingSession = await getPrismaClient().session.findFirst({
        where: { subscriptionId: data.subscription_id },
      });

      if (existingSession) {
        await getPrismaClient().session.update({
          where: { id: existingSession.id },
          data: {
            requestedTier: user.pendingTier,
            expiresAt: expiresAt ? new Date(expiresAt) : existingSession.expiresAt,
          },
        });
      }

      return; // Exit early since we've handled the renewal with the pending change
    }
  }

  // No pending change to apply - normal renewal flow
  // Determine tier from product_id (source of truth) - fallback to metadata only if no product_id
  // IMPORTANT: product_id reflects the CURRENT plan, metadata.requested_tier may be stale after plan changes
  let tier = data.product_id
    ? getTierCodeFromProductId(data.product_id)
    : data.metadata?.requested_tier || null;

  // Use existing tier if none found
  if (!tier) {
    tier = user.activeTier;
  }

  if (tier) {
    // Use subscription_period_interval from webhook if product lookup doesn't provide activeLength
    // Normalize frequency - DoDo uses "Month"/"Year", we use "MONTHLY"/"YEARLY"
    const activeLength =
      (data.product_id ? getActiveLengthFromProductId(data.product_id) : null) ||
      normalizeBillingFrequency(data.payment_frequency_interval ?? null) ||
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

  // Upsert processing payment record with payment_link
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
      paymentLink: data.payment_link || null,
      rawJson: rawPayload as object,
    },
    update: {
      status: PaymentStatus.PROCESSING,
      paymentLink: data.payment_link || null,
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
 *
 * NEW FLOW: If there's a pending plan change, mark as PAYMENT_NEEDED
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

  // Build update data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {
    subscriptionStatus: SubscriptionStatus.ON_HOLD,
  };

  // ============================================================
  // NEW PLAN CHANGE FLOW: If there's a pending plan change, mark as PAYMENT_NEEDED
  // ============================================================
  // Re-fetch to get latest data including new fields
  const freshUser = await getPrismaClient().userMapping.findUnique({
    where: { userUuid: user.userUuid },
  });

  if (freshUser?.planChangeStatus === PlanChangeStatus.PENDING) {
    console.log(`⚠️ Plan change payment ON HOLD for user ${user.userUuid}`);
    console.log(`   Marking plan change as PAYMENT_NEEDED`);
    updateData.planChangeStatus = 'PAYMENT_NEEDED';
  }

  await getPrismaClient().userMapping.update({
    where: { userUuid: user.userUuid },
    data: updateData,
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
        status: SessionStatus.PENDING,
      },
    });
    console.log(`✅ Updated session ${existingSession.sessionId} to PENDING (on hold)`);
  }
}

/**
 * Handle subscription.plan_changed webhook event
 * Fired when a subscription plan is upgraded or downgraded
 *
 * NEW FLOW:
 * - If planChangeStatus is already PENDING (set by change-plan API), this webhook
 *   just confirms the plan change was registered with DoDo
 * - We do NOT update the tier here - that happens in payment.succeeded
 * - For deferred changes (downgrades/frequency), we schedule for end of billing cycle
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
  const newActiveLength =
    (data.product_id ? getActiveLengthFromProductId(data.product_id) : null) ||
    normalizeBillingFrequency(data.payment_frequency_interval ?? null) ||
    null;

  // Use next_billing_date or current_period_end (current billing period end)
  const expiresAt = data.next_billing_date || data.current_period_end;

  if (!newTier) {
    console.log(
      `⚠️ Plan changed but could not determine new tier from product_id: ${data.product_id}`
    );
    return;
  }

  const currentTier = user.activeTier || 'FREE';
  const currentLength = user.activeLength;

  // Determine the type of change
  const changeType: SubscriptionChangeType = determineChangeType(
    currentTier,
    newTier,
    currentLength,
    newActiveLength
  );

  console.log(
    `🔄 Plan change webhook received: ${currentTier}/${currentLength} → ${newTier}/${newActiveLength}`
  );
  console.log(`📋 Change type: ${getChangeTypeDescription(changeType)}`);

  // Re-fetch user to get latest plan change status
  const freshUser = await getPrismaClient().userMapping.findUnique({
    where: { userUuid: user.userUuid },
  });

  // ============================================================
  // NEW FLOW: Check if plan change was already initiated via API
  // ============================================================
  if (freshUser?.planChangeStatus === PlanChangeStatus.PENDING) {
    // Plan change was initiated via our API - just log confirmation
    // The pending info is already stored, and payment.succeeded will complete it
    console.log(`✅ Plan change webhook confirms pending change for user ${user.userUuid}`);
    console.log(`   Waiting for payment.succeeded to apply: ${freshUser.pendingTier}`);

    // Update dodoCustomerId if available
    if (data.customer?.customer_id && !freshUser.dodoCustomerId) {
      await getPrismaClient().userMapping.update({
        where: { userUuid: user.userUuid },
        data: { dodoCustomerId: data.customer.customer_id },
      });
    }

    // Log for audit
    console.log('Plan change details:', JSON.stringify(rawPayload, null, 2));
    return;
  }

  // ============================================================
  // LEGACY/EXTERNAL FLOW: Plan change initiated outside our API
  // Store pending info for processing
  // ============================================================
  console.log(`📋 Plan change initiated externally for user ${user.userUuid}`);

  switch (changeType) {
    case 'IMMEDIATE_UPGRADE':
      // For upgrades, store as pending with PENDING status
      await getPrismaClient().userMapping.update({
        where: { userUuid: user.userUuid },
        data: {
          planChangeStatus: PlanChangeStatus.PENDING,
          pendingTier: newTier,
          pendingActiveLength: newActiveLength,
          pendingTierEffectiveDate: new Date(),
          pendingChangeType: changeType,
          pendingProductId: data.product_id || null,
          planChangeInitiatedAt: new Date(),
          dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
        },
      });
      console.log(
        `📋 Pending upgrade stored for user ${user.userUuid}: ${currentTier} → ${newTier} (waiting for payment)`
      );
      break;

    case 'DEFERRED_DOWNGRADE':
    case 'DEFERRED_FREQUENCY_CHANGE':
      // Deferred changes don't require payment - they take effect at end of cycle
      // Mark as COMPLETED since they're scheduled and will auto-apply
      await getPrismaClient().userMapping.update({
        where: { userUuid: user.userUuid },
        data: {
          planChangeStatus: PlanChangeStatus.COMPLETED, // No payment needed for deferred changes
          pendingTier: newTier,
          pendingActiveLength: newActiveLength,
          pendingTierEffectiveDate: user.tierExpiresAt,
          pendingChangeType: changeType,
          pendingProductId: data.product_id || null,
          planChangeInitiatedAt: new Date(),
          dodoCustomerId: data.customer?.customer_id || user.dodoCustomerId,
        },
      });
      console.log(
        `📅 Deferred change scheduled for user ${user.userUuid}: ${currentTier} → ${newTier} (effective: ${user.tierExpiresAt?.toISOString()})`
      );
      break;

    case 'NO_CHANGE':
      console.log(`ℹ️ No actual change detected for user ${user.userUuid}`);
      break;
  }

  // Update session if exists
  const existingSession = await getPrismaClient().session.findFirst({
    where: { subscriptionId: data.subscription_id },
  });

  if (existingSession) {
    await getPrismaClient().session.update({
      where: { id: existingSession.id },
      data: {
        requestedTier: changeType === 'IMMEDIATE_UPGRADE' ? newTier : existingSession.requestedTier,
        expiresAt: expiresAt ? new Date(expiresAt) : existingSession.expiresAt,
      },
    });
    console.log(`✅ Updated session ${existingSession.sessionId}`);
  }

  // Log for audit
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
