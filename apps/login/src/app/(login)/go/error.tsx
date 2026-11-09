"use client";

/**
 * Route-level error boundary for the one-click invite landing page (/go). Next.js app
 * router picks the most specific error.tsx for the segment that threw, so this one
 * shadows the shared (login)/error.tsx (the raw "LOGIN ERROR" debug box with a "Try
 * Again" button that just re-throws the same error -- see review/ux.md finding #1,
 * screenshot revoked-link-react-error-441.png) for every render under /go specifically.
 *
 * Deliberately no "Try Again"/reset() button: a guest landing here already hit an
 * uncaught error in a Server Component render (React's own generic, digest-only
 * "Minified React error" in production -- the real cause is server-side only, see
 * CHANGELOG 0.2.7 and zitadel.ts's freshCache for the specific bug this page used to hit
 * unguarded). Retrying the exact same render reproduces the exact same condition, which
 * is exactly what the review observed ("Try Again does not recover, loops back into the
 * same crash") -- a plain, calm dead end styled like the page's own "Already used" /
 * "Link not found" copy is the only honest way forward here.
 */

import { useEffect } from "react";

const ASK_AARON = "aaron@causality.bio";

export default function GoError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("invite landing page crashed:", error);
  }, [error]);

  return (
    <div className="flex flex-col space-y-4">
      <h1>Link no longer valid</h1>
      <p className="ztdl-p text-center">
        This link is no longer valid. Ask Aaron for a new one:{" "}
        <a href={`mailto:${ASK_AARON}`} className="text-[#4AB349] hover:underline">
          {ASK_AARON}
        </a>
      </p>
    </div>
  );
}
