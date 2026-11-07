"use server";

/**
 * Completes a one-click invite: creates a Zitadel session authenticated by an email-OTP
 * factor whose code this server generates and consumes itself (never shown to the browser,
 * never mailed -- there is no SMTP anywhere in this stack), then writes Login V2's own
 * `sessions` cookie exactly as `createSessionAndUpdateCookie` (src/lib/server/cookie.ts)
 * would. That cookie is all `src/app/login/route.ts` needs to recognize the browser on the
 * very next OIDC authorize redirect and finish it via CreateCallback with zero further
 * screens -- see causality-auth docs/STATUS-phase2.md "Step A" for why that's true.
 *
 * This deliberately does NOT go through createSessionFromChecksAndChallenges's usual caller
 * (src/lib/server/session.ts / cookie.ts), because those run every challenge through
 * sanitizeChallenges (src/lib/server/challenges.ts), which rewrites otp_email's returnCode to
 * sendCode on purpose (GHSA-3gwm-5wx8-4gm6: a returnCode hands the OTP back in the response,
 * which is only safe when the caller constructing the challenge is trusted, not an untrusted
 * browser). Here the challenge is 100% server-constructed -- the only input from the browser
 * is our own single-use, high-entropy, already-claimed invite token -- so returnCode is the
 * correct and safe choice, and reusing the sanitized path would silently break this flow
 * (Zitadel would try to email the code through a stack with no SMTP configured, see
 * causality-auth/CLAUDE.md "No SMTP, ever").
 */

import { addSessionToCookie } from "@/lib/cookies";
import { getSecuritySettings, createSessionFromChecksAndChallenges, setSession, getSession } from "@/lib/zitadel";
import { getServiceConfig } from "@/lib/service-url";
import { create, timestampMs, Duration } from "@zitadel/client";
import { ChecksSchema } from "@zitadel/proto/zitadel/session/v2/session_service_pb";
import { RequestChallengesSchema, RequestChallenges_OTPEmail_ReturnCodeSchema } from "@zitadel/proto/zitadel/session/v2/challenge_pb";
import { headers } from "next/headers";
import { InviteRecord } from "./invite-store";

// Independent of oauth2-proxy's access-token lifetime (300s, see causality-auth
// docs/STATUS-pilot.md) -- that bounds how fast a revoke takes effect. This bounds how long
// Login V2 keeps recognizing the browser for a *future* full re-authentication redirect, the
// same default every other stock session in this app uses (src/lib/server/session.ts).
const SESSION_COOKIE_LIFETIME: Duration = { seconds: BigInt(24 * 60 * 60), nanos: 0 } as Duration;

class InviteRedeemError extends Error {}

/** Returns the lab-next URL to redirect the browser to once the session cookie is set. */
export async function completeInviteSession(record: InviteRecord): Promise<string> {
  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  const checks = create(ChecksSchema, {
    user: { search: { case: "userId", value: record.userId } },
  });
  const challenges = create(RequestChallengesSchema, {
    otpEmail: {
      deliveryType: { case: "returnCode", value: create(RequestChallenges_OTPEmail_ReturnCodeSchema, {}) },
    },
  });

  const created = await createSessionFromChecksAndChallenges({
    serviceConfig,
    checks,
    challenges,
    lifetime: SESSION_COOKIE_LIFETIME,
  });

  const code = created.challenges?.otpEmail;
  if (!created.sessionId || !created.sessionToken || !code) {
    throw new InviteRedeemError("Zitadel did not return an otpEmail returnCode for the invite session");
  }

  const verifyChecks = create(ChecksSchema, { otpEmail: { code } });
  const updated = await setSession({
    serviceConfig,
    sessionId: created.sessionId,
    sessionToken: created.sessionToken,
    checks: verifyChecks,
    challenges: undefined,
    lifetime: SESSION_COOKIE_LIFETIME,
  });

  if (!updated?.sessionToken) {
    throw new InviteRedeemError("otpEmail check did not verify the invite session");
  }

  const { session } = await getSession({
    serviceConfig,
    sessionId: created.sessionId,
    sessionToken: updated.sessionToken,
  });

  if (!session?.factors?.user?.loginName || !session.factors.otpEmail?.verifiedAt) {
    throw new InviteRedeemError("invite session is not authenticated after the otpEmail check");
  }

  const securitySettings = await getSecuritySettings({ serviceConfig });
  const iFrameEnabled = !!securitySettings?.embeddedIframe?.enabled;

  await addSessionToCookie({
    session: {
      id: created.sessionId,
      token: updated.sessionToken,
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
