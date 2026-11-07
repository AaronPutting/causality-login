# causality-login

Causality.bio's fork of Zitadel's Login V2 UI (`apps/login` from the `zitadel/zitadel`
monorepo, tag `v4.20.1`), replacing the stock `ghcr.io/zitadel/zitadel-login` image in
`causality-auth`'s `docker-compose.yml`. One addition on top of stock: a one-click invite
flow, so a guest who clicks a link Aaron pasted into his own mail lands on the shared lab
page already signed in, no password, no passkey setup, no code to type.

Private for now (AGPL note below). This repo and whatever's built from it on the Keller
are the only copies; there is no CI, the build runs by hand on the Keller.

## Layout

- `apps/login/` -- the fork itself: unmodified `apps/login` from the upstream monorepo
  (import commit) plus `src/lib/server/invite-store.ts`, `src/lib/server/invite-redeem.ts`,
  and `src/app/(login)/go/{page.tsx,actions.ts}`, all new, Causality.bio-only files. Every
  other file under `apps/login/` is upstream's, untouched, in this release.
- `Dockerfile` -- not upstream's (that one assumes a CI step already produced
  `.next/standalone` inside the full monorepo). This one builds from scratch: a `build`
  stage that installs the trimmed workspace, generates and builds `@zitadel/client`/
  `@zitadel/proto` from the vendored `proto/` sources, then runs `apps/login`'s own `build`
  script, then the stock runtime stage unchanged.
- `proto/`, `packages/zitadel-client/`, `packages/zitadel-proto/` -- the monorepo's own
  generated-code sources for the two packages `apps/login` depends on as `workspace:*`, not
  pinned npm versions (see "Build" below for why).
- `package.json`, `pnpm-workspace.yaml` -- the monorepo root's, trimmed to three workspace
  members (`apps/login`, `packages/zitadel-client`, `packages/zitadel-proto`). No lockfile
  is carried (see "Rebasing" below).

## How the one-click flow works

1. `causality-auth/tools/invite.py` creates (or reuses) the Zitadel user, registers an
   OTP-Email factor on it, and writes a one-time token's record to a directory shared with
   this app's container (`CAUSALITY_INVITE_STORE_DIR`). The token itself is never written to
   disk, only `sha256(token)` as the record's filename -- see
   `apps/login/src/lib/server/invite-store.ts` for the full reasoning. The printed URL is
   `https://login.causality.bio/ui/v2/login/go?token=<token>`.
2. `GET /ui/v2/login/go?token=...` (`apps/login/src/app/(login)/go/page.tsx`) only ever
   renders -- a mail scanner's prefetch must never consume the invite. It shows one button:
   "Continue as `<name>` (`<email>`)".
3. The POST from that button (`apps/login/src/app/(login)/go/actions.ts`) claims the token
   exactly once (atomic rename, see invite-store.ts), then
   `apps/login/src/lib/server/invite-redeem.ts` creates a Zitadel Session API v2 session,
   challenges it with that OTP-Email factor using `returnCode` (the code is generated and
   consumed entirely server-side, never shown to the browser, never mailed -- there is still
   no SMTP anywhere in this stack, see `causality-auth/CLAUDE.md`), and verifies it. That
   authenticates the session with no password and no passkey.
4. The authenticated session is written into Login V2's own `sessions` cookie, using the
   *same, unmodified* `addSessionToCookie` stock Login V2 already has
   (`apps/login/src/lib/cookies.ts`). Nothing about how that cookie is read, matched to an
   OIDC auth request, or turned into a `CreateCallback` is touched -- `src/app/login/route.ts`
   and `src/lib/server/flow-initiation.ts` are 100% stock.
5. The browser is redirected straight to the target lab-next page. That page load is what
   triggers oauth2-proxy's normal OIDC authorize redirect; Login V2 finds the cookie from
   step 4 already there, recognizes it as the one session on this browser, and completes the
   auth request via its own existing `CreateCallback` call with no further screen -- the same
   code path that already lets a *returning* logged-in user skip the login screen, just
   reached a different way for a brand-new browser. See `causality-auth`
   `docs/STATUS-phase2.md` "Step A" for the live API trace that proves each step of this
   before any of it was built, and the end-to-end browser test's screenshots.

Why `invite-redeem.ts` doesn't call the stock `createSessionAndUpdateCookie` /
`updateOrCreateSession` helpers (`src/lib/server/cookie.ts`, `src/lib/server/session.ts`):
those run every challenge through `sanitizeChallenges` (`src/lib/server/challenges.ts`),
which deliberately rewrites an `otpEmail` `returnCode` request into `sendCode` --
GHSA-3gwm-5wx8-4gm6, a real fix for a real vulnerability when the challenge is
browser-controlled. Ours isn't: the only browser input into this whole flow is the
already-claimed, single-use invite token, and the challenge itself is 100%
server-constructed. Reusing the sanitized path here would silently break the flow (Zitadel
would try to email the code, and there is no SMTP configured to send it). See the long
comment at the top of `invite-redeem.ts` for the full argument; re-read it before ever
routing another code path through `createSessionFromChecksAndChallenges` with `returnCode`.

## Branding

Deliberately *not* done by editing this app's components for most screens. Zitadel's own
branding/label policy (`PUT /admin/v1/policies/label` plus the logo upload endpoints, both
via `causality-auth/tools/zitadel_api.py`, never through the public hostname) already
flows into every stock screen through `getBrandingSettings` /
`<DynamicTheme branding={...}>` -- see `THEME_ARCHITECTURE.md` and `THEME_CUSTOMIZATION.md`
in `apps/login/` for how that and the `NEXT_PUBLIC_THEME_*` layout env vars work. The new
`/go` page uses the same `<DynamicTheme>` wrapper, so it picks up the same branding with no
extra code. Logo asset and exact colors: see `causality-auth` `docs/STATUS-phase2.md`
"Step C".

## Build

On the Keller, from this repo's root:

```bash
docker build -t causality-login:<version> .
```

Then point `causality-auth/docker-compose.yml`'s `zitadel-login` service at that tag
(`image: causality-login:<version>`) and `docker compose up -d zitadel-login`.

No lockfile is committed here. `apps/login/package.json` depends on `@zitadel/client` and
`@zitadel/proto` as `workspace:*`, exactly like upstream, built from this repo's own vendored
`proto/` directory by the `build` stage (`pnpm --filter @zitadel/proto run generate` runs
`buf generate` against `../../proto`, then `pnpm --filter @zitadel/client run build` runs
`tsup`). This is **not** a detail to swap for an npm pin to "simplify" the build: the
published `@zitadel/client`/`@zitadel/proto` npm packages are versioned independently of
`zitadel/zitadel`'s own git tags (via changesets, no 1:1 mapping to a server release) and
confirmed live (2026-11-07) to not match what `apps/login @ v4.20.1` expects -- neither
`1.2.0` nor `1.3.1` exports `Code`/`ConnectError` from the main module or `verifyJwt` from
`/node` the way this tag's source imports them; the build fails outright, it does not just
drift quietly. `pnpm install --no-frozen-lockfile` runs fresh on every build. This is a
private, single-maintainer fork built by hand on one host; if that ever changes, pin a
lockfile and vendor it.

## Rebasing onto a new Zitadel release

1. In a scratch clone of `zitadel/zitadel` at the new tag, sparse-checkout `apps/login`,
   `packages/zitadel-client`, `packages/zitadel-proto`, and `proto` (plus, at the root,
   `package.json`, `pnpm-workspace.yaml`, and `buf.work.yaml` -- `git checkout <tag> --
   <path>` for the individual files, sparse-checkout only takes directories).
2. Diff that against this repo's `apps/login/` *before* our own commits (i.e. against the
   import commit, `ae95602` for this release) to see everything upstream changed; do the
   same for `packages/zitadel-client/` and `packages/zitadel-proto/` since their generated
   output feeds `apps/login` directly.
3. Replace `apps/login/`, `packages/zitadel-client/`, `packages/zitadel-proto/`, and
   `proto/` with the new tag's versions, re-apply our four new files (`invite-store.ts`,
   `invite-redeem.ts`, `go/page.tsx`, `go/actions.ts`) and re-check every file they import
   from (`src/lib/cookies.ts`, `src/lib/zitadel.ts`, `src/lib/server/challenges.ts`,
   `src/components/{button,dynamic-theme}.tsx`) still has the same shape -- a `git diff`
   against the previous import commit on exactly those paths is the fast way to see what
   moved.
4. Rewrite `pnpm-workspace.yaml` to list exactly `apps/login`, `packages/zitadel-client`,
   `packages/zitadel-proto` again if the new tag's own `pnpm-workspace.yaml` changed shape.
5. Rebuild (`docker build`, which runs `buf generate` and `tsup` against the new `proto/`
   and package sources as part of the build stage -- no separate step needed), re-run the
   test plan in `causality-auth` `docs/STATUS-phase2.md`, retag.

## AGPL note

`zitadel/zitadel` is AGPL-3.0 (`LICENSE`, carried over from upstream). AGPL requires
offering this modified app's source to anyone who uses it over a network, once outside
people actually use it. This repo stays **private** until Aaron decides it's time to open
it -- that's his call, not a default. Until then, the only people who "use" it are Aaron and
pilot invitees he personally vouches for, not the public.

## CLAUDE.md

See `CLAUDE.md` in this repo for the same operating rules as `causality-auth` (no SMTP, no
real third-party email in this repo, secrets never printed, versioned releases, etc.) --
this app and that one are deployed together and share the same constraints.
