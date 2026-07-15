// Verifies a Play Billing purchase token against the Google Play Developer
// API, then marks the caller's entitlements row purchased. Dormant along
// with the rest of the paywall — deploy it any time, it only matters once
// public.config.paywall_enabled is flipped true and the app starts calling
// purchaseUnlock()/restorePurchases() (see src/entitlement.js).
//
// Required secrets (supabase secrets set ...):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — auto-provided by Supabase
//   ANDROID_PACKAGE_NAME                     — e.g. run.kprun.twa
//   GOOGLE_SERVICE_ACCOUNT_EMAIL              — from the Play Console service account
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY        — PEM, with literal \n for newlines

import { createClient } from "npm:@supabase/supabase-js@2";

const ANDROID_PACKAGE_NAME = Deno.env.get("ANDROID_PACKAGE_NAME") ?? "";
const SERVICE_ACCOUNT_EMAIL = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
const SERVICE_ACCOUNT_PRIVATE_KEY = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of buf) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const contents = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const raw = Uint8Array.from(atob(contents), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    raw,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

// Exchanges the service account key for a short-lived Google OAuth2 access
// token via the standard JWT-bearer grant (RFC 7523).
async function getGoogleAccessToken(): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(new TextEncoder().encode(JSON.stringify(header)))}.` +
    `${base64url(new TextEncoder().encode(JSON.stringify(claims)))}`;
  const key = await importPrivateKey(SERVICE_ACCOUNT_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

// purchaseState: 0 = purchased, 1 = canceled, 2 = pending.
async function verifyWithPlay(productId: string, purchaseToken: string, accessToken: string) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${ANDROID_PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Play purchase lookup failed: ${await res.text()}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthenticated" }), { status: 401 });
  }

  const { purchaseToken, productId } = await req.json();
  if (!purchaseToken || !productId) {
    return new Response(JSON.stringify({ error: "purchaseToken and productId required" }), { status: 400 });
  }

  try {
    const accessToken = await getGoogleAccessToken();
    const purchase = await verifyWithPlay(productId, purchaseToken, accessToken);

    if (purchase.purchaseState !== 0) {
      return new Response(JSON.stringify({ error: "Purchase not in a valid state", purchase }), { status: 402 });
    }

    // acknowledge (required by Play within 3 days, otherwise it auto-refunds)
    if (purchase.acknowledgementState === 0) {
      const ackUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
        `${ANDROID_PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}:acknowledge`;
      await fetch(ackUrl, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
    }

    const { error: updateError } = await supabaseAdmin
      .from("entitlements")
      .update({ purchased: true, purchase_token: purchaseToken, purchased_at: new Date().toISOString() })
      .eq("user_id", userData.user.id);
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
