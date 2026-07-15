// Paywall client logic. Dormant by design: every function here is safe to
// call at any time — while public.config.paywall_enabled is false, the
// server-side is_entitled() check always passes, so none of this actually
// blocks anyone. Flip that one row in Supabase to activate.
//
// Purchase flow uses the Digital Goods API (Play Billing surfaced to a TWA),
// only present inside the installed Android app — see isDigitalGoodsAvailable().
import { supabase } from "./supabaseClient.js";

// Must match the one-time product SKU created in Play Console before launch.
export const PRODUCT_SKU = "kopi_run_unlock";
const PLAY_BILLING_SERVICE = "https://play.google.com/billing";

let sessionReady = null;

// Ensures every visitor — app or browser — has a Supabase session (anonymous
// if they've never signed in). The entitlements row is created server-side by
// the on_auth_user_created trigger the moment this signup succeeds.
export function ensureSession() {
  if (!sessionReady) {
    sessionReady = (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return session;
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      return data.session;
    })();
  }
  return sessionReady;
}

// { paywallEnabled, purchased, trialDaysLeft, entitled }
export async function getEntitlementStatus() {
  await ensureSession();
  const [{ data: config }, { data: entitlement }] = await Promise.all([
    supabase.from("config").select("paywall_enabled").eq("id", true).maybeSingle(),
    supabase.from("entitlements").select("trial_started_at, purchased").maybeSingle(),
  ]);

  const paywallEnabled = !!config?.paywall_enabled;
  const purchased = !!entitlement?.purchased;
  const startedAt = entitlement?.trial_started_at ? new Date(entitlement.trial_started_at) : new Date();
  const msLeft = startedAt.getTime() + 7 * 24 * 60 * 60 * 1000 - Date.now();
  const trialDaysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));

  return {
    paywallEnabled,
    purchased,
    trialDaysLeft,
    entitled: !paywallEnabled || purchased || msLeft > 0,
  };
}

export function isDigitalGoodsAvailable() {
  return typeof window !== "undefined" && "getDigitalGoodsService" in window;
}

// Sends a Play Billing purchase token to the verify-purchase Edge Function,
// which checks it against the Play Developer API and marks the caller's
// entitlements row purchased on success.
async function verifyPurchaseToken(purchaseToken) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke("verify-purchase", {
    body: { purchaseToken, productId: PRODUCT_SKU },
    headers: { Authorization: `Bearer ${session?.access_token}` },
  });
  if (error) throw error;
  return data;
}

// Kicks off the Play Billing purchase flow via the Digital Goods API. Only
// callable from inside the installed TWA (see isDigitalGoodsAvailable()).
export async function purchaseUnlock() {
  const service = await window.getDigitalGoodsService(PLAY_BILLING_SERVICE);
  const details = await service.getDetails([PRODUCT_SKU]);
  if (!details.length) throw new Error(`Product ${PRODUCT_SKU} not found in Play Billing`);

  const paymentMethod = { supportedMethods: PLAY_BILLING_SERVICE, data: { sku: PRODUCT_SKU } };
  const request = new PaymentRequest([paymentMethod]);
  const response = await request.show();
  const { purchaseToken } = response.details;
  await response.complete("success");
  return verifyPurchaseToken(purchaseToken);
}

// Re-links an existing Play purchase to the current (possibly new, e.g. after
// reinstall) anonymous session. Call on app launch before showing any paywall
// UI so a reinstall never re-prompts someone who already paid.
export async function restorePurchases() {
  if (!isDigitalGoodsAvailable()) return null;
  const service = await window.getDigitalGoodsService(PLAY_BILLING_SERVICE);
  const purchases = await service.listPurchases();
  const owned = purchases.find((p) => p.itemId === PRODUCT_SKU);
  if (!owned) return null;
  return verifyPurchaseToken(owned.purchaseToken);
}
