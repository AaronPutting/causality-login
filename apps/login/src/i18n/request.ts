import { LANGS, LANGUAGE_COOKIE_NAME, LANGUAGE_HEADER_NAME } from "@/lib/i18n";
import { mergeMessages } from "@/lib/merge-messages";
import { getServiceConfig } from "@/lib/service-url";
import { getAllowedLanguages, getHostedLoginTranslation } from "@/lib/zitadel";
import { JsonObject } from "@zitadel/client";
import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

export default getRequestConfig(async () => {
  const fallback = "en";
  const cookiesList = await cookies();

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  let allowedLanguages = LANGS.map((l) => l.code);
  let defaultLanguage = fallback;

  try {
    const settings = await getAllowedLanguages({ serviceConfig });
    if (settings.allowedLanguages?.length) {
      const localLanguageCodes = LANGS.map((l) => l.code);
      allowedLanguages = settings.allowedLanguages.filter((l) => localLanguageCodes.includes(l));
    }
    if (settings.defaultLanguage) {
      defaultLanguage = settings.defaultLanguage;
    }
  } catch (e) {
    console.warn("Failed to load global settings", e);
  }

  let locale: string = defaultLanguage;

  const languageHeader = await (await headers()).get(LANGUAGE_HEADER_NAME);
  if (languageHeader) {
    // splits "en-US,en;q=0.9" to ["en", "US"] or ["en"]
    const headerLocale = languageHeader.split(",")[0].split("-")[0];
    if (allowedLanguages.includes(headerLocale)) {
      locale = headerLocale;
    }
  }

  const languageCookie = cookiesList?.get(LANGUAGE_COOKIE_NAME);
  if (languageCookie && languageCookie.value) {
    if (allowedLanguages.includes(languageCookie.value)) {
      locale = languageCookie.value;
    } else {
      // If the cookie tells a language that is other than the supported ones, fall back to the default.
      locale = defaultLanguage;
    }
  }

  const i18nOrganization = _headers.get("x-zitadel-i18n-organization") || ""; // You may need to set this header in middleware

  let translations: JsonObject | Record<string, never> = {};
  try {
    const i18nJSON = await getHostedLoginTranslation({
      serviceConfig,
      locale,
      organization: i18nOrganization,
    });

    if (i18nJSON) {
      translations = i18nJSON;
    }
  } catch (error) {
    console.warn("Error fetching custom translations:", error);
  }

  const customMessages = translations;

  // Zitadel's own hosted-login-translation API ships factory-default English copy for
  // "loginname" (title/description/labels), and it is merged in last below, so it silently
  // outranks locales/en.json. Confirmed live 2026-11-07 ("2b" polish pass): the real OIDC
  // requestId path resolves this instance-level translation and reverts the guest-friendly
  // "Sign in" / "Enter the email your invite was sent to." copy back to stock "Welcome back!".
  // Nothing here has ever deliberately configured a hosted override for this namespace, so drop
  // it before merging rather than let a Zitadel factory default beat an app file we maintain on
  // purpose. Every other namespace still takes a live hosted override exactly as before.
  if (customMessages && typeof customMessages === "object" && "loginname" in customMessages) {
    delete (customMessages as Record<string, unknown>).loginname;
  }

  // Load locale messages, fall back to default language messages if locale not found
  let localeMessages;
  try {
    localeMessages = (await import(`../../locales/${locale}.json`)).default;
  } catch {
    try {
      localeMessages = (await import(`../../locales/${defaultLanguage}.json`)).default;
    } catch {
      localeMessages = (await import(`../../locales/${fallback}.json`)).default;
    }
  }

  const fallbackMessages = (await import(`../../locales/${fallback}.json`)).default;

  return {
    locale,
    messages: mergeMessages(fallbackMessages, localeMessages, customMessages) as Record<string, string>,
  };
});
