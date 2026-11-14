import { Alert, AlertType } from "@/components/alert";
import { Button, ButtonVariants } from "@/components/button";
import { DynamicTheme } from "@/components/dynamic-theme";
import { Translated } from "@/components/translated";
import { UserAvatar } from "@/components/user-avatar";
import { resolveRedirectUri } from "@/lib/client";
import { getServiceConfig } from "@/lib/service-url";
import { loadMostRecentSession, loadSessionById } from "@/lib/session";
import { getBrandingSettings, getLoginSettings } from "@/lib/zitadel";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signedin");
  return { title: t("title", { user: "" }) };
}

export default async function Page(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  const { loginName, requestId, organization, sessionId } = searchParams;

  const branding = await getBrandingSettings({ serviceConfig, organization });

  const sessionFactors = sessionId
    ? await loadSessionById(serviceConfig, sessionId, organization)
    : await loadMostRecentSession({ serviceConfig, sessionParams: { loginName, organization } });

  let loginSettings;
  if (!requestId) {
    loginSettings = await getLoginSettings({ serviceConfig, organization });
  }

  const redirectUri = await resolveRedirectUri(
    requestId && sessionId ? { sessionId, requestId } : { loginName: loginName ?? sessionFactors?.factors?.user?.loginName },
    loginSettings?.defaultRedirectUri,
  );

  const isSamePage = redirectUri?.startsWith("/signedin") ?? false;

  // Causality.bio (0.2.8): signed in directly at login.causality.bio (no requestId, so no app
  // waiting for a callback) used to stop here on a page with a Continue button, or with
  // nothing at all before a defaultRedirectUri was set. If the instance login policy has a
  // defaultRedirectUri, go straight there instead. Any requestId (an OIDC/SAML request, or a
  // device_ flow, which must stay on this page) keeps stock behavior.
  if (!requestId && redirectUri && !isSamePage) {
    redirect(redirectUri);
  }

  return (
    <DynamicTheme branding={branding}>
      <div className="flex flex-col space-y-4">
        <h1>
          <Translated i18nKey="title" namespace="signedin" data={{ user: sessionFactors?.factors?.user?.displayName }} />
        </h1>
        <p className="ztdl-p mb-6 block">
          <Translated i18nKey="description" namespace="signedin" />
        </p>

        <UserAvatar
          loginName={loginName ?? sessionFactors?.factors?.user?.loginName}
          displayName={sessionFactors?.factors?.user?.displayName ?? loginName}
          showDropdown={!(requestId && requestId.startsWith("device_"))}
          searchParams={searchParams}
        />
      </div>

      <div className="w-full">
        {requestId && requestId.startsWith("device_") && (
          <Alert type={AlertType.INFO}>
            You can now close this window and return to the device where you started the authorization process to continue.
          </Alert>
        )}

        {redirectUri && !isSamePage && (
          <div className="mt-8 flex w-full flex-row items-center">
            <span className="flex-grow"></span>

            <Link href={redirectUri}>
              <Button type="submit" className="self-end" variant={ButtonVariants.Primary}>
                <Translated i18nKey="continue" namespace="signedin" />
              </Button>
            </Link>
          </div>
        )}
      </div>
    </DynamicTheme>
  );
}
