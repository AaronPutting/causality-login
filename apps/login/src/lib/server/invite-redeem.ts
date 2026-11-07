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
 * SECURITY (2026-11-07, docs/STATUS-phase2.md "2b"): right after confirming the session,
 * this file now also rotates the user's real Zitadel password to a fresh, immediately
 * discarded value (`burnInvitePassword`). The invite's password has no single-use concept of
 * its own the way the token does; without this, a password captured from anywhere (a backup,
 * a brief window before invite-store.ts's own redaction of the .used file lands) would go on
 * working indefinitely. This closes that off independent of invite-store.ts's fix -- the two
 * are deliberately both applied, not an either/or.
 */

import { addSessionToCookie } from "@/lib/cookies";
import {
  getSecuritySettings,
  createSessionFromChecksAndChallenges,
  getSession,
  setUserPassword,
} from "@/lib/zitadel";
import { getServiceConfig } from "@/lib/service-url";
import { create, timestampMs, Duration } from "@zitadel/client";
import { ChecksSchema } from "@zitadel/proto/zitadel/session/v2/session_service_pb";
import { randomInt } from "crypto";
import { headers } from "next/headers";
import { createLogger } from "@/lib/logger";
import { InviteRecord } from "./invite-store";

const logger = createLogger("invite-redeem");

// Independent of oauth2-proxy's access-token lifetime (300s, see causality-auth
// docs/STATUS-pilot.md) -- that bounds how fast a revoke takes effect. This bounds how long
// Login V2 keeps recognizing the browser for a *future* full re-authentication redirect, the
// same default every other stock session in this app uses (src/lib/server/session.ts).
const SESSION_COOKIE_LIFETIME: Duration = { seconds: BigInt(24 * 60 * 60), nanos: 0 } as Duration;

class InviteRedeemError extends Error {}

const BURN_PASSWORD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+";

/**
 * Never surfaced anywhere, never stored, discarded the instant this call returns: its only
 * job is to make the invite's own password stop working the moment the guest's session is
 * confirmed. 22 characters from a 76-symbol alphabet (~137 bits of entropy, well over the
 * 128-bit target -- see tools/invite.py's own password generator for the matching target on
 * the invite side), categories satisfied by construction (retried until true), matching the
 * instance's password complexity policy rather than guessing at it.
 */
function burnInvitePassword(): string {
  while (true) {
    let out = "";
    for (let i = 0; i < 22; i++) {
      out += BURN_PASSWORD_ALPHABET[randomInt(BURN_PASSWORD_ALPHABET.length)];
    }
    if (/[a-z]/.test(out) && /[A-Z]/.test(out) && /[0-9]/.test(out) && /[^A-Za-z0-9]/.test(out)) {
      return out;
    }
  }
}

/** Returns the lab-next URL to redirect the browser to once the session cookie is set. */
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

  // SECURITY: rotate now, before doing anything else -- see this file's top comment "2b".
  // Best-effort and non-fatal: the session above is already good, the guest's one-click
  // login must not fail just because this defense-in-depth call hit a transient error, and
  // invite-store.ts's own redaction of the .used record does not depend on this succeeding
  // either. Logged, not thrown.
  try {
    await setUserPassword({
      serviceConfig,
      userId: record.userId,
      password: burnInvitePassword(),
    });
  } catch (error) {
    logger.error("could not rotate invite password after redemption", { error });
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
  return `https://lab-next.causality.bio${page}`;
}
