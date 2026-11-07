# Changelog

## 0.1.1 - 2026-11-07

Fixes the one-click flow 0.1.0 shipped with, confirmed broken by a live end-to-end browser
test (not just the raw Session API, which is all the 0.1.0 "Step A" spike had checked): every
guest landed on Login V2's own `/accounts` picker instead of the target lab page. Root cause:
this app's own `session.ts` (`isSessionValid`/`hasVerifiedPrimaryFactor`, stock, unmodified)
only ever treats `password`, a user-verified passkey, or an IDP intent as a qualifying primary
factor for silently completing a *new* OIDC request. `otpEmail` is deliberately excluded there
regardless of what the raw Session API itself accepts.

`invite-redeem.ts` now creates the session with a `password` check instead, against a fresh,
random password `tools/invite.py` sets on the invited user at invite time (never shown to or
typed by anyone, rotates on every new invite). Confirmed live: a guest now lands directly on
the target lab-next page with zero intermediate screens. See `invite-redeem.ts`'s top comment
and causality-auth `docs/STATUS-phase2.md` "Step A" for the full story.

A user ever put through the 0.1.0 `otpEmail` flow ends up with
`AUTHENTICATION_METHOD_TYPE_OTP_EMAIL` permanently registered on them (Zitadel auto-registers
it on first verified use), which then makes `session.ts`'s MFA gate mandatory for that user
even under this fix. Remove it per-user with `DELETE /v2/users/{id}/otp_email` before
re-testing such a user.

## 0.1.0 - 2026-11-07

First release: a fork of `zitadel/zitadel`'s `apps/login` (tag `v4.20.1`, matching the
Zitadel server causality-auth runs) with one addition on top, a one-click invite flow at
`/ui/v2/login/go?token=...`. A guest clicks the link from Aaron's mail, sees "Continue as
`<name>` (`<email>`)", clicks once, and lands on the shared lab page already signed in: no
password, no passkey setup, no code to type anywhere.

Mechanism: the invite token (minted by causality-auth's `tools/invite.py`, stored as one
JSON file per token under a shared host directory, single-use via atomic rename) identifies
a Zitadel user. Redeeming it creates a Session API v2 session, challenges it with an
`otpEmail` factor using `returnCode` (the OTP never leaves this process, no mail is ever
sent), verifies that code against the session itself, and writes Login V2's own signed
`sessions` cookie. The very next OIDC authorize redirect (oauth2-proxy's) finds that cookie
and completes through Login V2's existing, unmodified `CreateCallback` path with no further
screen. See `README.md` "How the one-click flow works" and causality-auth
`docs/STATUS-phase2.md` "Step A" for the API-level proof this relies on.

Deliberately bypasses the stock `createSessionAndUpdateCookie`/`sanitizeChallenges` path
(`src/lib/server/invite-redeem.ts` explains why in detail: that path rewrites `returnCode`
to `sendCode` as a security fix for a different threat model, one where the browser
controls the challenge request; ours doesn't).

Branding: Causality.bio's label/logo set via Zitadel's own branding policy (no app code
changes needed for most screens), plus `NEXT_PUBLIC_THEME_*` layout variables. See README
"Branding".

No changes to password/MFA/passkey screens or any other stock Login V2 behavior in this
release.
