# Paywall — design + what's left

Status: backend and client plumbing built, dormant. Not activated.

## Decisions

- Pricing: one-time purchase (not subscription).
- Gate applies to everyone, including joiners — not just organizers.
- Launch free with a 7-day trial per identity, charge after.
- No-app joiner (iOS/desktop, browser link) after trial: blocked, must install the Android app. No permanent free web tier.
- Android-only. No Play Integrity attestation — enforcement is payment-based (real Play Billing purchase token, unforgeable), not app-authenticity-based, so the same rule applies uniformly whether the request comes from the TWA or a bare browser tab hitting the public Netlify URL.

## Architecture

Identity: Supabase anonymous auth (`signInAnonymously()`), same origin for TWA and browser, so both get a real session and their own trial clock. A trigger on `auth.users` insert creates the `entitlements` row (`trial_started_at = now()`).

Gate: `public.is_entitled()` (SQL, `security definer`) — true if `config.paywall_enabled` is false, or the caller has purchased, or is within 7 days of `trial_started_at`. Wired into RLS on `orders`/`items` (select/insert/update/delete). While the flag is false this always evaluates true, so current fully-open behavior is unchanged.

Purchase: Play Billing one-time IAP, surfaced to the TWA via the Digital Goods API (`getDigitalGoodsService`). Client sends the purchase token to the `verify-purchase` Edge Function, which verifies it against the Play Developer API, acknowledges it, and sets `entitlements.purchased = true`.

Reinstall/restore: on every app launch, `restorePurchases()` calls `service.listPurchases()` and re-verifies any existing token through the same Edge Function, re-linking the purchase to whatever (possibly new) anonymous session the reinstalled app has. Prevents a genuine payer from being asked to pay again after clearing app data.

Activation: flip one row — `UPDATE public.config SET paywall_enabled = true`. No app rebuild, no redeploy.

## Built (this session)

- `supabase/schema.sql` — `config` table, `entitlements` table, `handle_new_user` trigger, `is_entitled()`, RLS policies updated to call it, grants.
- `src/entitlement.js` — `ensureSession`, `getEntitlementStatus`, `purchaseUnlock`, `restorePurchases`, `isDigitalGoodsAvailable`.
- `supabase/functions/verify-purchase/index.ts` — Play Developer API token verification + acknowledgement + entitlement update.
- `src/App.jsx` — silent `ensureSession()` + `restorePurchases()` call on mount. No visible UI change.

## What's left before activation

1. **Play Console setup**
   - Create one-time managed product, SKU `kopi_run_unlock` (must match `PRODUCT_SKU` in `src/entitlement.js`).
   - Create a service account under the Play Console API access page, grant it "View financial data" + release/product access needed for `purchases.products.get`.
   - Download its key, set as Edge Function secrets: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (PEM, `\n`-escaped), `ANDROID_PACKAGE_NAME`.

2. **Deploy the Edge Function** — `supabase functions deploy verify-purchase`, then `supabase secrets set ...` for the above.

3. **Paywall UI** (not built yet) — needs, roughly:
   - Trial countdown banner (`getEntitlementStatus().trialDaysLeft`), shown only when `paywallEnabled` is true.
   - Blocking screen for expired trial / no purchase, with a "Buy" button calling `purchaseUnlock()`.
   - Error/pending states for `PaymentRequest` (user cancels, network failure, `purchaseState === 2` pending).
   - This UI should render conditionally off `getEntitlementStatus()` so it stays invisible pre-activation without a code path change — just gate the components on `paywallEnabled`.

4. **Test before flipping the flag** — a staging Supabase project or a manual per-user override (e.g. temporarily set one test user's `trial_started_at` in the past) to exercise the expired-trial and purchase-success paths without affecting real users.

5. **Flip `paywall_enabled` to true** once the above is verified.

## Known limitation

Trial identity is per anonymous-auth session, stored in the TWA's origin storage. Uninstall + reinstall (or clearing app data) without an existing purchase resets the trial. Accepted tradeoff for launch — the actual revenue protection (blocking non-payers from the public link) is payment-token-based and unaffected; only free-trial abuse is possible, and only by uninstalling per attempt. Revisit if abused (e.g. require Google sign-in to start a trial).
