import type { BillingConfig } from "../billing/billing.js";
import { stripeGateway } from "../billing/gateway.js";
import { EXAMPLE_ORG_NAME } from "./example.js";
import { adEventsFromEnv } from "./ad-events.js";

/**
 * Billing settings from the environment:
 * STRIPE_SECRET_KEY (card payments), BILLING_SELLER_ORG_ID and
 * BILLING_SELLER_ENTITY_ID (the books that sell TrailBook), BILLING_BANK_ACCOUNT
 * (the account card payments land in, default the operating account) and
 * BILLING_ENFORCE=true (unpaid organisations become read-only) and
 * BILLING_CANADA=on (businesses with a Canadian billing address can
 * subscribe, in Canadian dollars; the Stripe key also needs Charges and
 * Balance read permission, to read each conversion). With none of
 * them set, everyone keeps full use and nobody is charged.
 */
export function billingFromEnv(env: Record<string, string | undefined> = process.env): BillingConfig {
  const seller = env.BILLING_SELLER_ORG_ID && env.BILLING_SELLER_ENTITY_ID
    ? { orgId: env.BILLING_SELLER_ORG_ID, entityId: env.BILLING_SELLER_ENTITY_ID, bankAccount: env.BILLING_BANK_ACCOUNT || undefined }
    : undefined;
  return {
    gateway: env.STRIPE_SECRET_KEY ? stripeGateway(env.STRIPE_SECRET_KEY) : undefined,
    seller,
    enforce: env.BILLING_ENFORCE === "true",
    canada: env.BILLING_CANADA === "on",
    freeOrgNames: [EXAMPLE_ORG_NAME],
    adEvents: adEventsFromEnv(env),
  };
}
