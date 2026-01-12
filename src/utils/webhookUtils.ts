import { getPrismaClient } from '../database/client';

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
   * Handle customer created event - extracts customer info and updates user mapping
   */
  static async handleCustomerCreated(data: Record<string, unknown>): Promise<void> {
    const customerId = data.customer_id as string | undefined;
    const email = data.email as string | undefined;

    if (email && customerId) {
      await this.updateDodoCustomerId(email, customerId);
    } else {
      console.log('Missing customer_id or email in customer.created event');
    }
  }

  /**
   * Find user by UUID or email
   */
  static async findUser(userUuid?: string, email?: string) {
    if (userUuid) {
      const user = await getPrismaClient().userMapping.findUnique({
        where: { userUuid },
      });
      if (user) return user;
    }

    if (email) {
      return getPrismaClient().userMapping.findUnique({
        where: { email },
      });
    }

    return null;
  }
}
