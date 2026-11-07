"use server";

/**
 * The redeem step of the one-click invite (see src/lib/server/invite-redeem.ts for why this
 * runs the raw Session API calls instead of the stock, sanitized helpers). Bound directly as
 * a <form action={redeemInvite}> in page.tsx: Next.js Server Actions already reject a POST
 * whose Origin doesn't match this deployment's own host, which is the CSRF defense for this
 * form (there is nothing else on the page a forged cross-site request could usefully target,
 * since the token itself is the only input and a forger who already has it could just open
 * the link directly).
 */

import { redirect } from "next/navigation";
import { createLogger } from "@/lib/logger";
import { claimInvite } from "@/lib/server/invite-store";
import { completeInviteSession } from "@/lib/server/invite-redeem";

const logger = createLogger("invite-go");

export async function redeemInvite(formData: FormData): Promise<void> {
  const token = String(formData.get("token") || "");

  const claimed = await claimInvite(token);
  if (claimed.status !== "ok") {
    redirect(`/go?token=${encodeURIComponent(token)}`);
  }

  let target: string;
  try {
    target = await completeInviteSession(claimed.record);
  } catch (error) {
    // The invite is already consumed at this point (claimInvite is one-shot), so a failure
    // here is not retryable with the same link -- it needs a fresh one from Aaron, same as
    // an expired or already-used link. Logged, not shown: the guest never sees a stack trace.
    logger.error("invite redemption failed after the token was claimed", { error });
    redirect(`/go?token=${encodeURIComponent(token)}&outcome=error`);
  }

  redirect(target);
}
