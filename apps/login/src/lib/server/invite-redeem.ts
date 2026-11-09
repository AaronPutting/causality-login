"use server";

/**
 * Completes a one-click invite: creates a Zitadel session authenticated by a `password`
 * check against a random, never-disclosed password `causality-auth/tools/invite.py` set on
 * this user at invite time (the guest never sees it, never types it), then writes Login V2's
 * own `sessions` cookie exactly as `createSessionAndUpdateCookie` (src/lib/server/cookie.ts)
 * would. That cookie is all `src/app/login/route.ts` needs to recognize the browser on the
 * very next OIDC authorize redirect and finish it via its own existing CreateCallback call
 * with zero further screens -- see causality-auth docs/STATUS-phase2.md "Step A".
 *
 * Why a password check, not an otpEmail challenge (this file's first version): confirmed
 * live 2026-11-07, against the real running stack, not guessed. An otpEmail-only session
 * DOES fully authenticate at the raw Session API level, and CreateCallback DOES accept it
 * directly (that is exactly the Step A spike's result). But the stock flow-initiation this
 * design deliberately reuses unmodified -- src/lib/server/flow-initiation.ts calling
 * findValidSession() / isSessionValid() in src/lib/session.ts -- imposes its OWN, stricter
 * definition of "a session worth silently completing a *new* OIDC request for", one that
 * only ever counts `password`, a user-verified `passkey`, or an `IDP intent` as a qualifying
 * primary factor (hasVerifiedPrimaryFactor, same file, also shared with the
 * credential-enrollment guard, GHSA-45f2-5q3r-xgg6 -- not a check to route around lightly).
 * otpEmail is deliberately excluded there: it is Zitadel's idea of a *second* factor, not a
 * standalone sign-in method, regardless of what the raw Session API will accept. A live
 * end-to-end browser test with the otpEmail version landed every guest on Login V2's own
 * /accounts picker instead of the lab page -- a real break of the one-click goal, not a
 * cosmetic issue -- because findValidSession() never selected that session. A `password`
 * check sets factors.password.verifiedAt in a single CreateSession call (no challenge/verify
 * round trip needed at all, and -- since there is no challenge object in this request --
 * sanitizeChallenges's otp_email-specific rewrite, src/lib/server/challenges.ts,
 * GHSA-3gwm-5wx8-4gm6, does not even apply here), which findValidSession() already accepts.
 * Re-read this whole comment before ever touching how this file authenticates a session.
 *
 * SECURITY, rotation REMOVED (2026-11-07, docs/STATUS-phase2.md "2b"): this file briefly also
 * rotated the user's real Zitadel password right after confirming the session
 * (`burnInvitePassword`, same day). Real-world failure caught it: Aaron's own redemption left
 * his session with factors = ['user'] only, no password factor, and oauth2-proxy's follow-up
 * authorize round-trip (GET / -> /oauth2/auth 401 -> /oauth2/start?rd=/, a SECOND, separate
 * OIDC request Login V2 re-validates via findValidSession()/isSessionValid() in
 * src/lib/session.ts) landed back on a login screen instead of completing silently. Zitadel
 * invalidates a session's verified password factor instance-wide the moment the user's
 * password changes, not just for future sessions -- so the very call meant to protect this
 * session broke the one-click redirect it was issued for. The check at this function's own
 * `session.factors.password?.verifiedAt` above (right after CreateSession, before any
 * rotation) always passed regardless, which is why earlier testing missed this: it validated
 * the session at creation, never the later re-validation a real oauth2-proxy round trip forces.
 * invite-store.ts's own redaction of the `.used` record (the password field stripped on
 * write) is kept and is enough on its own: nobody ever learns the invite password's preimage
 * once that file is rewritten, and password login for guests is refused server-side anyway
 * (password-allowlist.ts). Do not reintroduce a post-redemption password change here.
 */

import { addSessionToCookie } from "@/lib/cookies";
import { getSecuritySettings, createSessionFromChecksAndChallenges, getSession } from "@/lib/zitadel";
import { getServiceConfig } from "@/lib/service-url";
import { create, timestampMs, Duration } from "@zitadel/client";
import { ChecksSchema } from "@zitadel/proto/zitadel/session/v2/session_service_pb";
import { headers } from "next/headers";
import { InviteRecord } from "./invite-store";

// Independent of oauth2-proxy's access-token lifetime (300s, see causality-auth
// docs/STATUS-pilot.md) -- that bounds how fast a revoke takes effect. This bounds how long
// Login V2 keeps recognizing the browser for a *future* full re-authentication redirect, the
// same default every other stock session in this app uses (src/lib/server/session.ts).
const SESSION_COOKIE_LIFETIME: Duration = { seconds: BigInt(24 * 60 * 60), nanos: 0 } as Duration;

// Fixed allow list, not a template string built from record.site: a record is written by
// tools/invite.py (or share-api/server.py, a separate repo/language each) and this is the
// one place that turns an arbitrary string field into an actual redirect origin, so it stays
// a closed set on purpose -- no open-redirect vector, same reasoning as the page check below.
// lab.causality.bio went live on our own Zitadel/oauth2-proxy stack 2026-11-09 (see
// causality-auth docs/STATUS-pilot.md); lab-next stays the staging target it always was.
const SITE_ORIGINS: Record<string, string> = {
  lab: "https://lab.causality.bio",
  "lab-next": "https://lab-next.causality.bio",
};
const DEFAULT_SITE = "lab";

class InviteRedeemError extends Error {}

/** Returns the URL to redirect the browser to once the session cookie is set, on whichever
 * site the invite named (record.site, defaulting to "lab" for a missing or unrecognized
 * value -- see SITE_ORIGINS above). */
export async function completeInviteSession(record: InviteRecord): Promise<string> {
  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  const checks = create(ChecksSchema, {
    user: { search: { case: "userId", value: record.userId } },
    password: { password: record.password },
  });

  const created = await createSessionFromChecksAndChallenges({
    serviceConfig,
    checks,
    challenges: undefined,
    lifetime: SESSION_COOKIE_LIFETIME,
  });

  if (!created.sessionId || !created.sessionToken) {
    // Most likely cause: tools/invite.py was run again for the same email after this token
    // was minted but before it was redeemed, which rotates the user's password and leaves
    // this older token's stored password stale (Zitadel returns COMMAND-3M0fs, "invalid
    // credentials"). The newest invite link for a given guest is the one that works; this
    // is the same trade-off a password-reset-by-mail flow has (only the latest link is
    // live), just enforced by the password check instead of a separate revocation list.
    throw new InviteRedeemError("Zitadel did not create a session for the invite (bad or superseded password)");
  }

  const { session } = await getSession({
    serviceConfig,
    sessionId: created.sessionId,
    sessionToken: created.sessionToken,
  });

  if (!session?.factors?.user?.loginName || !session.factors.password?.verifiedAt) {
    throw new InviteRedeemError("invite session is not authenticated after the password check");
  }

  const securitySettings = await getSecuritySettings({ serviceConfig });
  const iFrameEnabled = !!securitySettings?.embeddedIframe?.enabled;

  await addSessionToCookie({
    session: {
      id: created.sessionId,
      token: created.sessionToken,
      loginName: session.factors.user.loginName,
      organization: session.factors.user.organizationId,
      creationTs: session.creationDate ? `${timestampMs(session.creationDate)}` : "",
      expirationTs: session.expirationDate ? `${timestampMs(session.expirationDate)}` : "",
      changeTs: session.changeDate ? `${timestampMs(session.changeDate)}` : "",
    },
    iFrameEnabled,
  });

  // A fixed origin is always prepended below, so there is no open-redirect vector here even
  // in principle -- this is just keeping a malformed record (page missing its leading slash,
  // or starting with "//" and so looking like a scheme-relative URL once concatenated) from
  // producing a confusing destination. Validated more strictly at write time in
  // tools/invite.py; this is a second, independent check, not the only one.
  const page = record.page && record.page.startsWith("/") && !record.page.startsWith("//") ? record.page : "/";
  const origin = (record.site && SITE_ORIGINS[record.site]) || SITE_ORIGINS[DEFAULT_SITE];
  return `${origin}${page}`;
}
