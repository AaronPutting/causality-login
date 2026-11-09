/**
 * The one-click invite landing page: Causality.bio's own addition, not part of upstream
 * Login V2. A bare GET only ever renders (mail scanners prefetch links, see
 * src/lib/server/invite-store.ts), the POST from the button is the only thing that redeems
 * the invite (src/app/(login)/go/actions.ts). Never cached: every render depends on which
 * token is in the query string and whether it has already been claimed.
 */

import { DynamicTheme } from "@/components/dynamic-theme";
import { createLogger } from "@/lib/logger";
import { getServiceConfig } from "@/lib/service-url";
import { peekInvite } from "@/lib/server/invite-store";
import { getBrandingSettings } from "@/lib/zitadel";
import { Metadata } from "next";
import { headers } from "next/headers";
import { ReactNode } from "react";
import { redeemInvite } from "./actions";
import { InviteSubmitButton } from "./invite-submit-button";

const logger = createLogger("invite-go-page");

export const dynamic = "force-dynamic";
export const revalidate = false;
export const fetchCache = "default-no-store";

export const metadata: Metadata = { title: "Causality.bio Lab" };

const ASK_AARON = "aaron@causality.bio";

// Green (#4AB349, the brand's primary) with an underline only on hover, everywhere this
// address appears on a guest-reachable screen (2026-11-07, docs/STATUS-phase2.md "2b" polish
// pass) -- it was plain, unstyled text before, not a real affordance to write to Aaron.
function AaronMailLink() {
  return (
    <a href={`mailto:${ASK_AARON}`} className="text-[#4AB349] hover:underline">
      {ASK_AARON}
    </a>
  );
}

function Gone({ heading, body }: { heading: string; body: ReactNode }) {
  return (
    <div className="flex flex-col space-y-4">
      <h1>{heading}</h1>
      <p className="ztdl-p text-center">{body}</p>
    </div>
  );
}

export default async function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  const forcedError = searchParams.outcome === "error";
  const forcedRevoked = searchParams.outcome === "revoked";

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  // Branding is cosmetic (logo/colors; DynamicTheme and ThemeWrapper both already treat it
  // as optional). Never let a transient settings-API hiccup take down the whole landing
  // page over it -- this guest may already be looking at the "link no longer valid" or
  // "already used" copy below, which must render regardless. See zitadel.ts's freshCache
  // for the specific bug this used to hit unguarded (CHANGELOG 0.2.7).
  let branding;
  try {
    branding = await getBrandingSettings({ serviceConfig });
  } catch (error) {
    logger.error("failed to load branding settings for the invite landing page", {
      error: error instanceof Error ? error.message : String(error),
    });
    branding = undefined;
  }

  // Defense in depth: peekInvite only touches the local filesystem and shouldn't normally
  // throw, but a surprise here (disk hiccup, permissions) must still land on the calm
  // "something went wrong" copy below, never on the route's raw error boundary (go/error.tsx).
  async function safePeek() {
    try {
      return await peekInvite(token);
    } catch (error) {
      logger.error("failed to look up the invite record", { error: error instanceof Error ? error.message : String(error) });
      return { status: "error" } as const;
    }
  }

  const peeked = forcedRevoked
    ? ({ status: "revoked" } as const)
    : forcedError
      ? ({ status: "error" } as const)
      : await safePeek();

  return (
    <DynamicTheme branding={branding}>
      {peeked.status === "ok" ? (
        <div className="flex flex-col space-y-6">
          <div className="flex flex-col space-y-4">
            <h1>You are invited</h1>
            <p className="ztdl-p text-center">Aaron shared a page with you.</p>
            <p className="ztdl-p text-center">{peeked.record.email}</p>
          </div>
          <form action={redeemInvite} className="flex w-full flex-col">
            <input type="hidden" name="token" value={token} />
            <InviteSubmitButton>Continue as {peeked.record.name || peeked.record.email}</InviteSubmitButton>
          </form>
        </div>
      ) : peeked.status === "used" ? (
        <Gone
          heading="Already used"
          body={
            <>
              This link was already used. Ask Aaron for a new one: <AaronMailLink />
            </>
          }
        />
      ) : peeked.status === "expired" ? (
        <Gone
          heading="Link expired"
          body={
            <>
              This link expired. Ask Aaron for a new one: <AaronMailLink />
            </>
          }
        />
      ) : peeked.status === "revoked" ? (
        <Gone
          heading="Link no longer valid"
          body={
            <>
              This link is no longer valid. Ask Aaron for a new one: <AaronMailLink />
            </>
          }
        />
      ) : peeked.status === "error" ? (
        <Gone
          heading="Something went wrong"
          body={
            <>
              The link did not work this time. Ask Aaron to send a new one: <AaronMailLink />
            </>
          }
        />
      ) : (
        <Gone
          heading="Link not found"
          body={
            <>
              This link does not work. Ask Aaron for a new one: <AaronMailLink />
            </>
          }
        />
      )}
    </DynamicTheme>
  );
}
