# Changelog

## 0.2.6 - 2026-11-09

One-click invites can now land on `lab.causality.bio`, not just `lab-next`. Since about
15:40 UTC today `lab.causality.bio` itself runs on this same Zitadel/oauth2-proxy stack
(`causality-lab` v0.6.1, `run-oidc.sh`), so this is the first invite redemption had anywhere
to go other than staging.

`InviteRecord` (`invite-store.ts`) gets an optional `site` field. `invite-redeem.ts`'s
`completeInviteSession` maps it through a fixed `SITE_ORIGINS` allow list (`{lab:
"https://lab.causality.bio", "lab-next": "https://lab-next.causality.bio"}`) rather than
building the redirect origin out of the stored string directly -- same reasoning as the
existing `page` check right next to it: a record is written by a different repo
(`causality-auth/tools/invite.py`, soon also `share-api/server.py`), so the one place that
turns an arbitrary field into an actual redirect target stays a closed set. A missing or
unrecognized `site` defaults to `"lab"` (previously `lab-next` was the only option, hardcoded
-- this flips the default now that `lab` is the real target and `lab-next` goes back to being
the one callers have to ask for explicitly).

## 0.2.5 - 2026-11-09

Publication prep, ahead of this repo going public (AGPL, see README "AGPL note"), plus two
small UI fixes Aaron asked for.

CSP tightened to a nonce-based strict policy, replacing the stock Next.js default
(`'unsafe-inline'`/`'unsafe-eval'` on `script-src`). `proxy.ts` now generates one nonce per
request and forwards it as the `x-nonce` request header; `lib/csp.ts`'s `buildCSP` uses it as
`script-src 'self' 'nonce-<value>' 'strict-dynamic' https:` with no `unsafe-eval` anywhere.
Next.js reads the nonce back out of its own `Content-Security-Policy` response header and
applies it to every framework-rendered script automatically (RSC hydration payload, page
bundles) -- see https://nextjs.org/docs/app/guides/content-security-policy. `style-src` is
now split: `style-src-elem` is nonce'd (covers `<style>` tags), `style-src-attr` keeps
`'unsafe-inline'` (CSP has no nonce mechanism for the `style=""` attribute, and Radix UI's
popovers/tooltips/dropdowns position themselves by writing to it at runtime with no fixed,
hashable value). Added `base-uri 'self'` and `form-action 'self'` (neither was set before).
`server/flow-initiation.ts`'s `buildAutoSubmitFormResponse` (the SAML POST-binding
auto-submit form, unreached in this pilot -- no SAML IdP configured) used an inline
`onload=""` handler, which a nonce can't cover either; replaced it with a nonce'd `<script>`
tag. Removed the unused, misleading `constants/csp.js` (dead code, didn't match the real
enforced policy). Verified with zero `securitypolicyviolation` events across sign-in, invite
landing, already-used, expired, not-found and new-device, plus one full invite redemption
through to an authenticated `lab-next.causality.bio` session.

Desktop sign-in page's email input had no visible resting border (stock Zitadel's 33%-alpha
`#1a191954` was close to invisible against the near-white card). Bumped to 55%
(`#1a19198c` light, `#f9f7f785` dark) so the empty field reads as a field before focus.

Added a "Source code" link to `https://github.com/AaronPutting/causality-login` in the
login page's footer, every screen, alongside the theme switch.

README and this file's "Repo visibility" note rewritten for the repo going public: explicit
link to upstream `zitadel/zitadel`, what Causality changed on top of it, and why AGPL makes
the source public even though the app itself stays pilot-only.

## 0.2.4 - 2026-11-07

Instant feedback on the two submit buttons Aaron actually clicks, after his own test showed
a visible gap between clicking Continue and anything happening (invite redemption's password
check plus the oauth2-proxy redirect chain take close to 2.5s together -- see
`causality-auth` docs/STATUS-phase2.md "2c" for the measured hops).

`go/invite-submit-button.tsx` (new): wraps the invite landing page's Continue button in a
client component using `useFormStatus` (same pattern `idps/base-button.tsx` already used for
the IDP buttons) -- on submit it disables immediately, shows the existing `Spinner`, and
swaps its label to "Opening the page...". `go/page.tsx` now renders this instead of a bare
`Button`. `username-form.tsx`'s sign-in Continue button already disabled and spun on submit
(`loading` state); it was just missing a label change -- now shows "One moment..." while
`loading` is true. Neither button could double-submit before this (`disabled` was already
wired); this only adds the visible feedback.

## 0.2.3 - 2026-11-07

Production bug, caught by Aaron's own real-world test: invite redemption left his browser on
the Sign-in/new-device screen instead of the lab.

`invite-redeem.ts` used to rotate the user's real Zitadel password to a fresh, discarded
value right after confirming the session (defense in depth from "2b", belt-and-braces on top
of `invite-store.ts` already stripping the password from the `.used` record). Zitadel
invalidates a session's verified `password` factor instance-wide the moment the password
changes -- not just for future sessions, but for the session that had just authenticated with
it. oauth2-proxy's follow-up OIDC authorize round-trip re-validates the session
(`findValidSession()`/`isSessionValid()`, `src/lib/session.ts`) and found only `factors.user`,
so it fell back to a login screen instead of completing silently. Removed the rotation
entirely. `invite-store.ts`'s existing redaction of the `.used` record is kept and is enough
on its own: nobody learns the invite password's preimage once that file is rewritten, and
guest password login is refused server-side anyway (`password-allowlist.ts`). Also removed
the now-unused `burnInvitePassword()` helper and its imports, and corrected
`causality-auth/tools/invite.py`'s docstring, which still described the rotation.

Why earlier testing missed this: `invite-redeem.ts`'s own check
(`session.factors.password?.verifiedAt`) runs right after `createSessionFromChecksAndChallenges`,
before the rotation call, so it always passed. The full end-to-end browser flow (Phase 2 test
item 1) was not re-run after "2b" introduced the rotation; see `docs/STATUS-phase2.md` item 9.

## 0.2.2 - 2026-11-07

Two fixes from a second coordinator review of the 0.2.1 screenshots.

Invite-landing button not full width: `go/page.tsx` wrapped the Continue button in a plain
`<form action={redeemInvite}>`, which is not a flex container, so the inline-flex `Button`
sized to its own content instead of stretching -- added `className="flex w-full flex-col"`
to that form, the same pattern `device-form.tsx`'s form already used correctly.

The real `/sampling` redirect (a genuine OIDC `requestId`) showed Zitadel's own stock
"Welcome back! / Enter your login details. / Loginname" copy instead of Causality's
guest-friendly "Sign in / Enter the email your invite was sent to. / Email", even though
`locales/en.json` already had the right text and a page hit without a resolvable org
context rendered it fine. Root cause: `i18n/request.ts` merges three message sources with
the last one winning, and the last one, Zitadel's own `getHostedLoginTranslation` API,
ships its own factory-default English copy for every key in the `loginname` namespace --
nothing here ever asked Zitadel to customize that text, so its stock defaults silently beat
the app's own locale file on any request that resolves a real org (i.e. every real login).
Fixed by dropping the `loginname` key from that hosted-translation payload before the merge
in `i18n/request.ts`, so our own copy is authoritative there while every other namespace
still takes a live Zitadel-side override exactly as before. `components/username-form.tsx`
(the component this page renders) also lost its Back button and switched its input to
`autoComplete="email"`, and its submit button is now a direct flex-column child instead of
being pinned `self-end` in a row next to Back, so it is full width like every other Continue
button in the app.

Live walk confirmed end to end: `/sampling` unauthenticated to `/loginname` ("Sign in",
full-width Continue) to `/new-device` (email pre-filled, green Continue) to the "This link
works on one device" result card.

## 0.2.1 - 2026-11-07

Polish pass before showing Aaron (coordinator review of the 0.2.0 screenshots). No
behaviour change, UI only.

Removed the language dropdown from `(login)/layout.tsx` -- English only, it looked
misplaced next to the theme switch. Centred every button label: `components/button.tsx`
had `inline-flex items-center` but no `justify-content`, so text defaulted to flex-start
inside the already-full-width button. Centred body text in the short status cards
(invite, used, expired, not found, error, new-device result, sign-in intro) by adding
`text-center` at each call site -- `DynamicTheme` only auto-centers when it receives two
children, and `go/page.tsx`/`device-form.tsx` both pass one, so none of this was
automatic.

Invite landing (`go/page.tsx`): button now reads "Continue as &lt;name&gt;" (or the email
when no name is known) on one line, with the email shown as its own muted centered line
above the button instead of inside it.

Logo (`components/logo.tsx`): dropped the fixed `height={150} width={150}` HTML
attributes in favour of `w-[170px] sm:w-[220px] h-auto`, so it renders about 220px wide
on desktop and scales down on phones using the SVG's own aspect ratio instead of a
disconnected fixed box.

Card padding (`components/dynamic-theme.tsx`): removed an always-empty trailing
`<div className="flex flex-row justify-between"></div>` from the top-to-bottom layout
branch. It added a `space-y-8` gap before nothing, which is why these cards had visibly
more empty space at the bottom than the top.

`aaron@causality.bio` is now a real `mailto:` link everywhere it appears (used, expired,
not found, error, invite-gone states, new-device result), styled `text-[#4AB349]
hover:underline` to match the brand green.

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
