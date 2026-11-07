/**
 * Shown instead of a password box to every guest who arrives without a valid session --
 * typically a new device, a browser with cleared cookies, or an old/expired invite link
 * someone tried to reuse by hand. Causality.bio's own addition, not part of upstream Login
 * V2. Routed here by src/lib/server/loginname.ts (see src/lib/server/password-allowlist.ts)
 * for every loginName except the console admin's; never shows a password field, never tells
 * an unknown email apart from a known one (see device-form.tsx: the email step never makes a
 * server call at all). See docs/STATUS-phase2.md "2b".
 */

import { DeviceForm } from "@/components/device-form";
import { DynamicTheme } from "@/components/dynamic-theme";
import { getServiceConfig } from "@/lib/service-url";
import { getBrandingSettings } from "@/lib/zitadel";
import { Metadata } from "next";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const revalidate = false;
export const fetchCache = "default-no-store";

export const metadata: Metadata = { title: "Causality.bio Lab" };

export default async function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const loginNameParam = searchParams.loginName;
  const defaultEmail = typeof loginNameParam === "string" ? loginNameParam : "";

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);
  const branding = await getBrandingSettings({ serviceConfig });

  return (
    <DynamicTheme branding={branding}>
      <DeviceForm defaultEmail={defaultEmail} />
    </DynamicTheme>
  );
}
