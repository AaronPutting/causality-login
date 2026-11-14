/**
 * Shown instead of a password box to every guest who arrives without a valid session --
 * typically a new device, a browser with cleared cookies, or an old/expired invite link
 * someone tried to reuse by hand. Causality.bio's own addition, not part of upstream Login
 * V2. Routed here by src/lib/server/loginname.ts (see src/lib/server/password-allowlist.ts)
 * for every loginName off the password allowlist.
 *
 * 0.2.8: says plainly what happened and what to do (ask Aaron for a new link, mailto) on the
 * first render. The old email-then-message form was a second, fake step that made no server
 * call either. The page still never tells an unknown email apart from a known one: it renders
 * the same text for every loginName and never looks the email up. "Use a different email"
 * goes back to the sign-in page with the same requestId, so a typo is not a dead end.
 */

import { DynamicTheme } from "@/components/dynamic-theme";
import { getServiceConfig } from "@/lib/service-url";
import { getBrandingSettings } from "@/lib/zitadel";
import { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = false;
export const fetchCache = "default-no-store";

export const metadata: Metadata = { title: "Causality.bio Lab" };

const ASK_AARON = "aaron@causality.bio";

export default async function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const requestId = typeof searchParams.requestId === "string" ? searchParams.requestId : "";
  const organization = typeof searchParams.organization === "string" ? searchParams.organization : "";

  const back = new URLSearchParams();
  if (requestId) back.append("requestId", requestId);
  if (organization) back.append("organization", organization);
  const backQuery = back.toString();
  const backHref = "/loginname" + (backQuery ? "?" + backQuery : "");

  const mailto = `mailto:${ASK_AARON}?subject=${encodeURIComponent("New sign-in link for Causality.bio")}`;

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);
  const branding = await getBrandingSettings({ serviceConfig }).catch(() => undefined);

  return (
    <DynamicTheme branding={branding}>
      <div className="flex flex-col space-y-4">
        <h1>Your sign-in link has expired</h1>
        <p className="ztdl-p text-center">
          Sign-in links work once, on the device and browser they were first opened on. Ask Aaron for a new one:{" "}
          <a href={mailto} className="text-[#4AB349] hover:underline">
            {ASK_AARON}
          </a>
          .
        </p>
        <p className="ztdl-p text-center">
          <Link href={backHref} className="hover:underline">
            Use a different email
          </Link>
        </p>
      </div>
    </DynamicTheme>
  );
}
