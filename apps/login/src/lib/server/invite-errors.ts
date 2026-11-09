/**
 * Deliberately NOT a "use server" file (unlike invite-redeem.ts/invite-store.ts/go/actions.ts
 * right next to it): every export of a "use server" module is treated by Next.js as a Server
 * Action, and a Server Action must be an async function -- this plain, synchronous classifier
 * broke the build with "Server Actions must be async functions" when it briefly lived in
 * invite-redeem.ts instead (causality-login 0.2.7). A tiny ordinary module, importable from
 * both server code and (if ever needed) a client component, is the fix.
 */

import { ConnectError } from "@zitadel/client";

/** True when `error` is the Zitadel session-check failure for a user whose account was
 * deactivated after the invite was minted -- someone removed via share-api's
 * `do_deactivate` or `tools/invite.py --revoke` (see causality-auth share-api/server.py),
 * or by hand in the Zitadel console. Confirmed live 2026-11-09 against the real stack:
 * Zitadel's Session API rejects the password check with a plain `ConnectError` whose
 * `rawMessage` is "Errors.User.NotActive (SESSION-Gj4ko)" -- not a structured
 * CredentialsCheckError like the wrong/superseded-password case this function's caller
 * also has to handle, so this checks the message text (Zitadel's own stable i18n key for
 * the condition) rather than a typed error detail. Used by `go/actions.ts` to show the
 * dedicated "link no longer valid" page instead of the generic "something went wrong" one. */
export function isInactiveUserError(error: unknown): boolean {
  return error instanceof ConnectError && /User\.NotActive/i.test(error.rawMessage ?? "");
}
