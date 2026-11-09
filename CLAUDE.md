# causality-login

Causality.bio's fork of Zitadel's Login V2 UI. README.md explains the one-click invite
mechanism, the build, and how to rebase onto a new Zitadel release. Read it first. This app
is deployed together with `causality-auth` (a separate repo) and shares its rules:

- **No SMTP, ever.** `src/lib/server/invite-redeem.ts` generates and consumes an OTP-Email
  code entirely server-side (`returnCode`, never `sendCode`). If a change ever needs this
  app to send mail, or to route a challenge through the stock `sanitizeChallenges`-guarded
  helpers with `returnCode`, stop and ask first -- read that file's top comment before
  touching this.
- **Secrets never printed.** `ZITADEL_SESSION_COOKIE_SECRET`, `ZITADEL_SERVICE_USER_TOKEN` /
  `..._FILE`, anything under `~/.config/causality/` on the Keller. If you must reference one
  in a message or a commit, print `sha256(secret)[:8]`, never the secret.
- **No real third-party email in this repo.** Use `pilot.test@causality.bio` for anything
  test-related, same as `causality-auth`.
- **Every release is versioned**: `VERSION`, `CHANGELOG.md`, tag `v<version>`, pushed. The
  image built from it is tagged to match (`causality-login:<version>`) and pinned (never
  `:latest`) in `causality-auth/docker-compose.yml`.
- **Repo visibility.** AGPL requires offering modified source once outside people use the
  app over a network -- see README "AGPL note". Aaron decided (2026-11-09) this repo goes
  public for that reason; he flips GitHub visibility himself after reading a secrets/history
  scan, never as a side effect of some other change here.
- **This repo and whatever's built from it on the Keller are the only copies.** No CI.
- Keep `NEXT_PUBLIC_AUTO_SUBMIT_CODE=false` (protects the stock invite/code screens from a
  mail scanner's prefetch GET) unless Aaron explicitly asks to change it.
- When rebasing onto a new upstream tag, keep upstream's code and our four new files
  (`invite-store.ts`, `invite-redeem.ts`, `go/page.tsx`, `go/actions.ts`) as clearly separate
  commits, so the next rebase is a diff against a known-unmodified import commit, not an
  archaeology project.
