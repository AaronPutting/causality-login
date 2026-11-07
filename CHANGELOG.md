# Changelog

## 0.2.0 - 2026-11-07

Phase 2b: closes the gap Phase 2's own invite mechanism opened, and removes the password
path for guests entirely. See causality-auth `docs/STATUS-phase2.md` "2b" for the full test
plan this tag is based on.

Security fix: a redeemed invite's `.used` record kept the guest's real password in plain
text (`src/lib/server/invite-store.ts`'s `claimInvite()` now strips the `password` field
before writing the renamed file). Defense in depth on top of that:
`src/lib/server/invite-redeem.ts` now also rotates the user's real Zitadel password to a
fresh, never-stored, never-shown 22-character value (`burnInvitePassword()`, ~137 bits,
built from all of upper/lower/digit/symbol) immediately after the session is confirmed, so
even a record written before this fix, or a bug that reintroduces the field, cannot be used
to sign in as the guest. `peekInvite()`/`claimInvite()` also now delete an expired record
outright on read instead of just reporting it expired.

No password path for guests: `src/lib/server/password-allowlist.ts` is a new, pure,
non-"use server" helper reading `CAUSALITY_PASSWORD_LOGIN_ALLOWLIST` (comma-separated
loginNames, case-insensitive). `src/lib/server/loginname.ts` routes every name not on it to
a new `/new-device` page instead of the stock password screen, and
`src/lib/server/password.ts`'s server action (`resetPassword`/`sendPassword`) checks the
same allowlist independently, so a guest who reaches the stock `/password` URL directly
(bypassing the routing decision entirely) still gets a generic "Could not verify password"
with no real check against Zitadel. Confirmed live for both paths.

New `/new-device` page (`src/app/(login)/new-device/`, `src/components/device-form.tsx`):
shown to every non-allowlisted loginName with no session. Guest enters an email
(autocomplete, pre-filled from `login_hint`/`loginName` when present), then sees a static
result card ("This link works on one device... Ask Aaron for a new one") with no backend
call between the two steps at all, so a known and an unknown email are provably
indistinguishable by construction, not just by the copy. Built to slot in passkey and
Google/Microsoft buttons later without restructuring.

Branding: house font switched from stock Login V2's Lato to Inter
(`src/app/(login)/layout.tsx`), matching every other Causality.bio surface. Colors,
dark-background logo (new gold "Lab" wordmark) and dark icon are set through Zitadel's own
branding policy, not app code — see causality-auth's changelog and `docs/STATUS-phase2.md`
"2b" for that half.

Known limitation, not addressed this release: the CSP in `src/lib/csp.ts` is stock upstream
Login V2 (`'unsafe-inline' 'unsafe-eval'` in `script-src`), not strict in the CSP Level 3
sense (no nonce/hash-based script-src). A real nonce-based rework would touch the whole
stock app, including the password/MFA/passkey flows this project has deliberately left
untouched, and was judged out of proportion for this phase.

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
