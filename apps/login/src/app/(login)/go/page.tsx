/**
 * The one-click invite landing page: Causality.bio's own addition, not part of upstream
 * Login V2. A bare GET only ever renders (mail scanners prefetch links, see
 * src/lib/server/invite-store.ts), the POST from the button is the only thing that redeems
 * the invite (src/app/(login)/go/actions.ts). Never cached: every render depends on which
 * token is in the query string and whether it has already been claimed.
 */

import { Button, ButtonSizes } from "@/components/button";
import { DynamicTheme } from "@/components/dynamic-theme";
import { getServiceConfig } from "@/lib/service-url";
import { peekInvite } from "@/lib/server/invite-store";
import { getBrandingSettings } from "@/lib/zitadel";
import { Metadata } from "next";
import { headers } from "next/headers";
import { redeemInvite } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = false;
export const fetchCache = "default-no-store";

export const metadata: Metadata = { title: "Causality.bio Lab" };

const ASK_AARON = "aaron@causality.bio";

function Gone({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="flex flex-col space-y-4">
      <h1>{heading}</h1>
      <p className="ztdl-p">{body}</p>
    </div>
  );
}

export default async function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  const forcedError = searchParams.outcome === "error";

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);
  const branding = await getBrandingSettings({ serviceConfig });

  const peeked = forcedError ? ({ status: "error" } as const) : await peekInvite(token);

  return (
    <DynamicTheme branding={branding}>
      {peeked.status === "ok" ? (
        <div className="flex flex-col space-y-6">
          <div className="flex flex-col space-y-4">
            <h1>You are invited</h1>
            <p className="ztdl-p">Aaron shared a page with you.</p>
          </div>
          <form action={redeemInvite}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" size={ButtonSizes.Large}>
              Continue as {peeked.record.name} ({peeked.record.email})
            </Button>
          </form>
        </div>
      ) : peeked.status === "used" ? (
        <Gone heading="Already used" body={`This link was already used. Ask Aaron for a new one: ${ASK_AARON}`} />
      ) : peeked.status === "expired" ? (
        <Gone heading="Link expired" body={`This link expired. Ask Aaron for a new one: ${ASK_AARON}`} />
      ) : peeked.status === "error" ? (
        <Gone
          heading="Something went wrong"
          body={`The link did not work this time. Ask Aaron to send a new one: ${ASK_AARON}`}
        />
      ) : (
        <Gone heading="Link not found" body={`This link does not work. Ask Aaron for a new one: ${ASK_AARON}`} />
      )}
    </DynamicTheme>
  );
}
