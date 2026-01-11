import { Router } from 'express';
import { DodoPaymentsService } from '../services/dodoPaymentsService';
import { AuthenticatedRequest, CheckoutSessionData, CheckoutResponse, WebhookData } from '../types';
import { WebhookUtils } from '../utils/webhookUtils';
import { getPrismaClient } from '../database/client';
import crypto from 'crypto';

export function createDodoPaymentsRoutes(): Router {
  const router = Router();

  router.post('/subscribe', async (req: AuthenticatedRequest, res, next) => {
    try {
      const { product_id, customer_email } = req.body;

      if (!product_id) {
        return res.status(400).json({ error: 'product_id is required' });
      }

      if (!customer_email) {
        return res.status(400).json({ error: 'customer_email is required' });
      }

      // Check if user exists and has dodo_customer_id
      const user = await getPrismaClient().userMapping.findUnique({
        where: { email: customer_email },
      });

      const client = DodoPaymentsService.getClient();

      const sessionData: CheckoutSessionData = {
        product_cart: [
          {
            product_id,
            quantity: 1,
          },
        ],
        return_url: 'http://stayonbrand.in',
      };

      // Use dodo_customer_id if exists, otherwise use email
      if (user?.dodoCustomerId) {
        sessionData.customer = { customer_id: user.dodoCustomerId };
        sessionData.metadata = { dodo_customer_id: user.dodoCustomerId };
      } else {
        sessionData.customer = { email: customer_email };
        sessionData.metadata = { customer_email };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = await client.checkoutSessions.create(sessionData as any);

      // Save session to database if user exists
      if (user) {
        await getPrismaClient().session.create({
          data: {
            sessionId: session.session_id,
            sobCustomerId: user.userUuid,
            status: 'created',
          },
        });
      }

      console.log('Redirect to:', session.checkout_url);

      res.json({
        success: true,
        session_url: session.checkout_url,
        session_id: session.session_id,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/checkout/:id', async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'checkout id is required' });
      }

      const client = DodoPaymentsService.getClient();

      const checkout = await client.checkoutSessions.retrieve(id);

      // Update session status in database based on checkout status
      const checkoutData = checkout as unknown as CheckoutResponse;
      if (checkoutData.status) {
        await getPrismaClient().session.updateMany({
          where: { sessionId: id },
          data: { status: checkoutData.status },
        });
        console.log(`✅ Updated session ${id} status to: ${checkoutData.status}`);
      }

      res.json(checkout);
    } catch (error) {
      next(error);
    }
  });

  router.get('/session/:sessionId', async (req: AuthenticatedRequest, res, next) => {
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
            },
          },
        },
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({
        session_id: session.sessionId,
        status: session.status,
        created_date: session.createdAt,
        user: {
          email: session.user.email,
          sob_id: session.user.userUuid,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/webhook', async (req, res) => {
    console.log('=== DoDo Payments Webhook Received ===');
    console.log('Headers:', req.headers);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('Query:', req.query);
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Timestamp:', new Date().toISOString());

    // Check if webhook key is configured
    if (!process.env.DODO_PAYMENTS_WEBHOOK_KEY) {
      console.log('⚠️ DODO_PAYMENTS_WEBHOOK_KEY not configured, skipping signature verification');
      await updateCustomerIdFromWebhook(req.body);
      await WebhookUtils.processWebhook(req.body);
      console.log('=====================================');
      return res.json({ received: true });
    }

    // Get required headers
    const webhookId = req.headers['webhook-id'] as string;
    const webhookSignature = req.headers['webhook-signature'] as string;
    const webhookTimestamp = req.headers['webhook-timestamp'] as string;

    if (!webhookId || !webhookSignature || !webhookTimestamp) {
      console.log('❌ Missing required webhook headers:');
      console.log('webhook-id:', webhookId);
      console.log('webhook-signature:', webhookSignature);
      console.log('webhook-timestamp:', webhookTimestamp);
      await WebhookUtils.processWebhook(req.body);
      console.log('=====================================');
      return res.json({ received: true });
    }

    try {
      // Manual signature verification following Standard Webhooks spec
      const rawPayload = JSON.stringify(req.body);
      const signedMessage = `${webhookId}.${webhookTimestamp}.${rawPayload}`;

      // Extract the secret key (remove 'whsec_' prefix if present)
      const secretKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY.replace('whsec_', '');

      // Compute HMAC SHA256
      const computedSignature = crypto
        .createHmac('sha256', Buffer.from(secretKey, 'base64'))
        .update(signedMessage, 'utf8')
        .digest('base64');

      // Extract signature from header (remove 'v1,' prefix)
      const headerSignature = webhookSignature.replace('v1,', '');

      console.log('Computed signature:', computedSignature);
      console.log('Header signature:', headerSignature);

      // Compare signatures
      if (computedSignature !== headerSignature) {
        console.log('❌ Webhook signature verification failed - signatures do not match');
        // Still process for development
        await WebhookUtils.processWebhook(req.body);
        console.log('=====================================');
        return res.json({ received: true, warning: 'Processed without signature verification' });
      }

      console.log('✅ Webhook signature verified successfully');

      // Update dodo_customer_id if subscription-related and customer info available
      await updateCustomerIdFromWebhook(req.body);

      // Process webhook using utils
      await WebhookUtils.processWebhook(req.body);

      console.log('=====================================');
      res.json({ received: true });
    } catch (error) {
      console.log('❌ Webhook signature verification error:', error);
      // Still process for development
      await WebhookUtils.processWebhook(req.body);
      console.log('=====================================');
      res.json({ received: true, warning: 'Processed without signature verification' });
    }
  });

  return router;
}

// Helper function to update customer ID from webhook
async function updateCustomerIdFromWebhook(payload: WebhookData): Promise<void> {
  try {
    // Check if it's a subscription-related event
    const eventType = payload.event_type;
    if (!eventType || !eventType.includes('subscription')) {
      return;
    }

    // Extract customer info from webhook payload
    const customer = payload.data.customer as { email?: string; customer_id?: string } | undefined;
    const customerEmail = customer?.email;
    const customerId = customer?.customer_id;

    if (!customerEmail || !customerId) {
      console.log('❌ Missing customer data:', { customerEmail, customerId });
      return;
    }

    // Find user by email and update dodo_customer_id only if it's null
    const result = await getPrismaClient().userMapping.updateMany({
      where: {
        email: customerEmail,
        dodoCustomerId: null,
      },
      data: {
        dodoCustomerId: customerId,
      },
    });

    console.log(
      `✅ Updated dodo_customer_id for ${customerEmail}: ${customerId} (${result.count} records updated)`
    );
  } catch (error) {
    console.log('❌ Error updating customer ID:', error);
  }
}
