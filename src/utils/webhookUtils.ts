import { getPrismaClient } from '../database/client';
import { WebhookData, CustomerData, PaymentData, SubscriptionData } from '../types';

export class WebhookUtils {
  /**
   * Updates user's dodo_customer_id if not already set
   */
  static async updateDodoCustomerId(email: string, dodoCustomerId: string): Promise<boolean> {
    try {
      // Find user by email
      const user = await getPrismaClient().userMapping.findUnique({
        where: { email },
      });

      if (!user) {
        console.log(`User not found for email: ${email}`);
        return false;
      }

      // Check if dodo_customer_id is already set
      if (user.dodoCustomerId) {
        console.log(`User ${email} already has dodo_customer_id: ${user.dodoCustomerId}`);
        return false;
      }

      // Update with new dodo_customer_id
      await getPrismaClient().userMapping.update({
        where: { email },
        data: { dodoCustomerId },
      });

      console.log(`✅ Updated dodo_customer_id for ${email}: ${dodoCustomerId}`);
      return true;
    } catch (error) {
      console.error('Error updating dodo_customer_id:', error);
      return false;
    }
  }

  /**
   * Process webhook based on event type
   */
  static async processWebhook(webhookData: WebhookData): Promise<void> {
    try {
      const { event_type, data } = webhookData;

      console.log(`Processing webhook event: ${event_type}`);

      switch (event_type) {
        case 'customer.created':
          await this.handleCustomerCreated(data as CustomerData);
          break;
        case 'payment.succeeded':
          await this.handlePaymentSucceeded(data as PaymentData);
          break;
        case 'subscription.created':
          await this.handleSubscriptionCreated(data as SubscriptionData);
          break;
        default:
          console.log(`Unhandled webhook event: ${event_type}`);
      }
    } catch (error) {
      console.error('Error processing webhook:', error);
    }
  }

  /**
   * Handle customer created event
   */
  private static async handleCustomerCreated(data: CustomerData): Promise<void> {
    const { customer_id, email } = data;

    if (email && customer_id) {
      await this.updateDodoCustomerId(email, customer_id);
    }
  }

  /**
   * Handle payment succeeded event
   */
  private static async handlePaymentSucceeded(data: PaymentData): Promise<void> {
    console.log('Payment succeeded:', data);
    // Add payment success logic here
  }

  /**
   * Handle subscription created event
   */
  private static async handleSubscriptionCreated(data: SubscriptionData): Promise<void> {
    console.log('Subscription created:', data);
    // Add subscription creation logic here
  }
}
