# QR invite: generate + scan

## Problem

Shared invite links depend on Android App Links verification, which is
fragile (falls back to a browser tab showing the raw `netlify.app` URL when
verification hasn't propagated — see today's Custom Tabs fallback issue).
For people already sitting together with the app installed, an in-app QR
code sidesteps App Links entirely: no link tap, no browser, no domain
exposure.

## Scope

- Add a QR code to the existing Share modal (`ShareModal` in `src/App.jsx`),
  alongside the current "Copy link" / code display — not a replacement.
- Add a "Scan QR" entry point on the Home screen, next to the existing
  "Join a run" code-entry card.
- Backend `shareLink` generation (`${window.location.origin}/order/${code}`)
  is unchanged. A later, separate piece of work will point the raw link at
  a Play Store redirect for non-app users — out of scope here.

## Design

**Generation** — `qrcode` npm package (offline, no external API calls,
~30KB). `ShareModal` renders the QR from the existing `shareLink` value
(passed back in as a prop) via `QRCode.toDataURL()`, displayed as an
`<img>`. Encodes the full URL, not the bare code, so it's scannable by any
generic camera/QR app too — those users fall through to the existing
browser + `SmartAppBanner` install flow.

**Scanning** — native `BarcodeDetector` API (built into Chrome/Android
WebView — the TWA's runtime — no new dependency). A "Scan QR" button on
`Home` opens a full-screen camera view (`getUserMedia`), samples frames to
a canvas, runs `BarcodeDetector.detect()`. On a decoded URL, extract the
order code (regex on `/order/([A-Za-z0-9]+)`) and reuse the same
lookup-then-navigate logic `handleJoin` already has, rather than duplicating
the Supabase query.

If `BarcodeDetector` isn't available (`'BarcodeDetector' in window` is
false — desktop Safari/Firefox), hide the "Scan QR" button entirely and
fall back to the existing manual code-entry input, which stays as-is
regardless. No polyfill — this app's scanning use case is inherently
Android/TWA-first.

**Error handling** — camera permission denied: show inline message, same
`err` state pattern `Home` already uses for join failures. Decoded content
that doesn't match the expected order-URL shape: treat as "no order found",
same message path as an invalid typed code.

## Out of scope

- Play Store redirect for the raw share link (separate future task).
- Cross-browser QR scanning via `jsQR` or similar (YAGNI — Android-only for
  now, revisit if desktop use becomes a real requirement).
- Changing what the QR encodes based on install state.
