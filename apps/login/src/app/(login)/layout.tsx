import "@/styles/globals.scss";

import { BackgroundWrapper } from "@/components/background-wrapper";
import { LanguageProvider } from "@/components/language-provider";
import { Skeleton } from "@/components/skeleton";
import { ThemeProvider } from "@/components/theme-provider";
import ThemeSwitch from "@/components/theme-switch";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Inter } from "next/font/google";
import React, { Suspense } from "react";

// Causality.bio house font (2026-11-07, docs/STATUS-phase2.md "2b"), replacing stock Login
// V2's Lato -- matches every other Causality.bio surface (brand pack, lab-next, the main
// site), all built on Inter. next/font/google still self-hosts the result (fetched once at
// build time, served from this app's own origin afterward, same as Lato was) -- no runtime
// request to fonts.googleapis.com either way, so this is a brand change, not a privacy one.
const inter = Inter({
  weight: ["400", "700", "900"],
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("title") };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className={`${inter.className}`} suppressHydrationWarning>
      <head />
      <body>
        <ThemeProvider>
          <Tooltip.Provider>
            <Suspense
              fallback={
                <BackgroundWrapper
                  className={`bg-background-light-600 dark:bg-background-dark-600 relative flex min-h-screen flex-col justify-center`}
                >
                  <div className="relative mx-auto w-full max-w-[440px] py-8">
                    <Skeleton>
                      <div className="h-40"></div>
                    </Skeleton>
                    <div className="flex flex-row items-center justify-end space-x-4 py-4">
                      <ThemeSwitch />
                    </div>
                  </div>
                </BackgroundWrapper>
              }
            >
              <LanguageProvider>
                <BackgroundWrapper
                  className={`bg-background-light-600 dark:bg-background-dark-600 relative flex min-h-screen flex-col justify-center`}
                >
                  <div className="relative mx-auto w-full max-w-[1100px] py-8">
                    <div>{children}</div>
                    <div className="mx-auto flex max-w-[440px] flex-row items-center justify-between px-4 py-4 md:max-w-full md:px-8">
                      <a
                        href="https://github.com/AaronPutting/causality-login"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400"
                      >
                        Source code
                      </a>
                      <ThemeSwitch />
                    </div>
                  </div>
                </BackgroundWrapper>
              </LanguageProvider>
            </Suspense>
          </Tooltip.Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
