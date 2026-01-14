#!/usr/bin/env npx ts-node
/**
 * Webhook Test Sender
 *
 * A script to generate and send test webhooks for customer data testing.
 * Automatically fetches customer_id and subscription_id from the database based on email.
 *
 * Usage:
 *   npx ts-node send-webhook.ts --email <email> --type <webhook_type>
 *
 * Example:
 *   npx ts-node send-webhook.ts --email test@example.com --type subscription.failed
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// Configuration
const WEBHOOK_URL = "https://petty-judie-overzealous.ngrok-free.dev/api/v1/dodopayments/webhook";
const BUSINESS_ID = "bus_H4ekzPSlcg";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://devuser:devpass@localhost:5432/dev_db?schema=public";

// Supported webhook types
const WEBHOOK_TYPES = [
  "subscription.created",
  "subscription.updated",
  "subscription.failed",
  "subscription.cancelled",
  "subscription.renewed",
  "subscription.paused",
  "subscription.resumed",
  "payment.succeeded",
  "payment.failed",
  "invoice.created",
  "invoice.paid",
  "invoice.overdue",
  "customer.created",
  "customer.updated",
] as const;

type WebhookType = (typeof WEBHOOK_TYPES)[number];

interface WebhookPayload {
  business_id: string;
  data: Record<string, unknown>;
  timestamp: string;
  type: WebhookType;
}

interface CustomerData {
  customer_id: string;
  email: string;
  name: string;
  phone_number: string | null;
}

interface Args {
  customer_id?: string;
  subscription_id?: string;
  email: string;
  type: WebhookType;
  name: string;
  url: string;
  interval?: string; // payment_frequency_interval (e.g., "Month", "Year")
  dryRun: boolean;
  verbose: boolean;
}

interface UserData {
  customerId: string;
  subscriptionId: string | null;
}

// Initialize Prisma client
async function createPrismaClient(): Promise<PrismaClient> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// Fetch user data from database
async function getUserDataByEmail(prisma: PrismaClient, email: string): Promise<UserData> {
  // Get user mapping by email
  const user = await prisma.userMapping.findUnique({
    where: { email },
    select: {
      dodoCustomerId: true,
      sessions: {
        where: {
          subscriptionId: { not: null },
        },
        orderBy: { createdDate: "desc" },
        take: 1,
        select: {
          subscriptionId: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error(`User with email "${email}" not found in database`);
  }

  if (!user.dodoCustomerId) {
    throw new Error(`User with email "${email}" has no dodo_customer_id`);
  }

  const subscriptionId = user.sessions[0]?.subscriptionId || null;

  return {
    customerId: user.dodoCustomerId,
    subscriptionId,
  };
}

function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

function getFutureDate(days: number = 30): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function getPastDate(days: number = 30): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function generateSubscriptionWebhook(
  customerId: string,
  subscriptionId: string,
  email: string,
  webhookType: WebhookType,
  name: string = "Test User",
  interval?: string
): WebhookPayload {
  const statusMap: Record<string, string> = {
    "subscription.created": "active",
    "subscription.updated": "active",
    "subscription.failed": "failed",
    "subscription.cancelled": "cancelled",
    "subscription.renewed": "active",
    "subscription.paused": "paused",
    "subscription.resumed": "active",
  };
  const status = statusMap[webhookType] || "active";
  const cancelledAt = webhookType === "subscription.cancelled" ? getCurrentTimestamp() : null;

  const payload: WebhookPayload = {
    business_id: BUSINESS_ID,
    data: {
      addons: [],
      billing: {
        city: "New York",
        country: "US",
        state: "New York",
        street: "11th Main",
        zipcode: "08002",
      },
      cancel_at_next_billing_date: webhookType === "subscription.cancelled",
      cancelled_at: cancelledAt,
      created_at: getPastDate(60),
      currency: "USD",
      customer: {
        customer_id: customerId,
        email: email,
        name: name,
        phone_number: null,
      } as CustomerData,
      discount_cycles_remaining: 3,
      discount_id: null,
      expires_at: null,
      metadata: {},
      meters: [],
      next_billing_date: getFutureDate(30),
      on_demand: false,
      payload_type: "Subscription",
      payment_frequency_count: 1,
      payment_frequency_interval: "Month",
      previous_billing_date: getPastDate(30),
      product_id: "pdt_RUST4raxbl0Rfe4VQi1z",
      quantity: 1,
      recurring_pre_tax_amount: 1000,
      status: status,
      subscription_id: subscriptionId,
      subscription_period_count: 10,
      tax_inclusive: false,
      trial_period_days: 0,
    },
    timestamp: getCurrentTimestamp(),
    type: webhookType,
  };

  // Only include payment_frequency_interval if provided
  if (interval) {
    payload.data.payment_frequency_interval = interval;
  }

  return payload;
}

function generatePaymentWebhook(
  customerId: string,
  subscriptionId: string,
  email: string,
  webhookType: WebhookType,
  name: string = "Test User"
): WebhookPayload {
  const status = webhookType === "payment.succeeded" ? "succeeded" : "failed";

  return {
    business_id: BUSINESS_ID,
    data: {
      payment_id: `pay_${subscriptionId.slice(4)}`,
      amount: 1000,
      currency: "USD",
      status: status,
      customer: {
        customer_id: customerId,
        email: email,
        name: name,
        phone_number: null,
      } as CustomerData,
      subscription_id: subscriptionId,
      payment_method: "card",
      created_at: getCurrentTimestamp(),
      metadata: {},
      payload_type: "Payment",
    },
    timestamp: getCurrentTimestamp(),
    type: webhookType,
  };
}

function generateInvoiceWebhook(
  customerId: string,
  subscriptionId: string,
  email: string,
  webhookType: WebhookType,
  name: string = "Test User"
): WebhookPayload {
  const statusMap: Record<string, string> = {
    "invoice.created": "pending",
    "invoice.paid": "paid",
    "invoice.overdue": "overdue",
  };
  const status = statusMap[webhookType] || "pending";

  return {
    business_id: BUSINESS_ID,
    data: {
      invoice_id: `inv_${subscriptionId.slice(4)}`,
      amount: 1000,
      currency: "USD",
      status: status,
      customer: {
        customer_id: customerId,
        email: email,
        name: name,
        phone_number: null,
      } as CustomerData,
      subscription_id: subscriptionId,
      due_date: getFutureDate(14),
      created_at: getCurrentTimestamp(),
      metadata: {},
      payload_type: "Invoice",
    },
    timestamp: getCurrentTimestamp(),
    type: webhookType,
  };
}

function generateCustomerWebhook(
  customerId: string,
  email: string,
  webhookType: WebhookType,
  name: string = "Test User"
): WebhookPayload {
  return {
    business_id: BUSINESS_ID,
    data: {
      customer_id: customerId,
      email: email,
      name: name,
      phone_number: null,
      created_at: webhookType === "customer.created" ? getCurrentTimestamp() : getPastDate(30),
      updated_at: getCurrentTimestamp(),
      metadata: {},
      payload_type: "Customer",
    },
    timestamp: getCurrentTimestamp(),
    type: webhookType,
  };
}

function generateWebhook(
  customerId: string,
  subscriptionId: string,
  email: string,
  webhookType: WebhookType,
  name: string = "Test User",
  interval?: string
): WebhookPayload {
  if (webhookType.startsWith("subscription.")) {
    return generateSubscriptionWebhook(customerId, subscriptionId, email, webhookType, name, interval);
  } else if (webhookType.startsWith("payment.")) {
    return generatePaymentWebhook(customerId, subscriptionId, email, webhookType, name);
  } else if (webhookType.startsWith("invoice.")) {
    return generateInvoiceWebhook(customerId, subscriptionId, email, webhookType, name);
  } else if (webhookType.startsWith("customer.")) {
    return generateCustomerWebhook(customerId, email, webhookType, name);
  } else {
    throw new Error(`Unknown webhook type: ${webhookType}`);
  }
}

async function sendWebhook(payload: WebhookPayload, url: string = WEBHOOK_URL): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Source": "test-script",
    },
    body: JSON.stringify(payload),
  });

  return response;
}

function parseArgs(args: string[]): Args {
  const result: Args = {
    customer_id: undefined,
    subscription_id: undefined,
    email: "",
    type: "subscription.failed",
    name: "Test User",
    url: WEBHOOK_URL,
    interval: undefined,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "-c":
      case "--customer_id":
        result.customer_id = nextArg;
        i++;
        break;
      case "-s":
      case "--subscription_id":
        result.subscription_id = nextArg;
        i++;
        break;
      case "-e":
      case "--email":
        result.email = nextArg;
        i++;
        break;
      case "-t":
      case "--type":
        if (!WEBHOOK_TYPES.includes(nextArg as WebhookType)) {
          console.error(`Invalid webhook type: ${nextArg}`);
          console.error(`Valid types: ${WEBHOOK_TYPES.join(", ")}`);
          process.exit(1);
        }
        result.type = nextArg as WebhookType;
        i++;
        break;
      case "-n":
      case "--name":
        result.name = nextArg;
        i++;
        break;
      case "-u":
      case "--url":
        result.url = nextArg;
        i++;
        break;
      case "-i":
      case "--interval":
        result.interval = nextArg;
        i++;
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
      case "-v":
      case "--verbose":
        result.verbose = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
Webhook Test Sender

Usage:
  npx ts-node send-webhook.ts [options]

Options:
  -e, --email            Customer email (required) - used to lookup customer_id and subscription_id from DB
  -t, --type             Webhook type (required)
  -c, --customer_id      Customer ID (optional - overrides DB lookup)
  -s, --subscription_id  Subscription ID (optional - overrides DB lookup)
  -n, --name             Customer name (default: Test User)
  -i, --interval         Subscription period interval (e.g., "Month", "Year") - sets active_length
  -u, --url              Webhook URL (default: ${WEBHOOK_URL})
  --dry-run              Print payload without sending
  -v, --verbose          Verbose output
  -h, --help             Show this help

Supported webhook types:
${WEBHOOK_TYPES.map((t) => `  - ${t}`).join("\n")}

Examples:
  # Simple - just email and type (fetches IDs from database)
  npx ts-node send-webhook.ts -e test@example.com -t subscription.failed

  # With subscription period interval (sets active_length)
  npx ts-node send-webhook.ts -e test@example.com -t subscription.renewed -i Year

  # Override with manual IDs
  npx ts-node send-webhook.ts -e test@example.com -t subscription.failed -c cus_123 -s sub_456

  # Dry run
  npx ts-node send-webhook.ts -e test@example.com -t customer.created --dry-run
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Validate required arguments
  if (!args.email) {
    console.error("Error: --email is required");
    process.exit(1);
  }

  let customerId = args.customer_id;
  let subscriptionId = args.subscription_id;

  // If customer_id or subscription_id not provided, fetch from database
  if (!customerId || !subscriptionId) {
    console.log(`Fetching user data from database for email: ${args.email}...`);

    let prisma: PrismaClient | null = null;
    try {
      prisma = await createPrismaClient();
      const userData = await getUserDataByEmail(prisma, args.email);

      customerId = customerId || userData.customerId;
      subscriptionId = subscriptionId || userData.subscriptionId || undefined;

      console.log(`Found customer_id: ${customerId}`);
      if (subscriptionId) {
        console.log(`Found subscription_id: ${subscriptionId}`);
      } else {
        console.log("No subscription found for this user");
      }
    } catch (error) {
      console.error(`Database error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    } finally {
      if (prisma) {
        await prisma.$disconnect();
      }
    }
  }

  // For subscription/payment/invoice webhooks, subscription_id is required
  const requiresSubscription = args.type.startsWith("subscription.") ||
                                args.type.startsWith("payment.") ||
                                args.type.startsWith("invoice.");

  if (requiresSubscription && !subscriptionId) {
    console.error(`Error: ${args.type} webhook requires a subscription_id, but none found in database.`);
    console.error("Please provide one manually with --subscription_id");
    process.exit(1);
  }

  // Generate the webhook payload
  let payload: WebhookPayload;
  try {
    payload = generateWebhook(
      customerId!,
      subscriptionId || "sub_placeholder",
      args.email,
      args.type,
      args.name,
      args.interval
    );
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  if (args.verbose || args.dryRun) {
    console.log("\nGenerated webhook payload:");
    console.log(JSON.stringify(payload, null, 2));
    console.log();
  }

  if (args.dryRun) {
    console.log("Dry run mode - webhook not sent");
    return;
  }

  // Send the webhook
  console.log(`\nSending ${args.type} webhook to ${args.url}...`);

  try {
    const response = await sendWebhook(payload, args.url);

    console.log(`Response status: ${response.status}`);

    if (args.verbose) {
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      console.log(`Response headers: ${JSON.stringify(headers)}`);

      try {
        const body = await response.json();
        console.log(`Response body: ${JSON.stringify(body)}`);
      } catch {
        const text = await response.text();
        console.log(`Response body: ${text}`);
      }
    }

    if (response.ok) {
      console.log("Webhook sent successfully!");
    } else {
      console.log(`Webhook failed with status ${response.status}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error sending webhook: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
