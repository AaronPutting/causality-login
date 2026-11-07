/**
 * Causality.bio's own addition: password login (and password reset) is refused for every
 * loginName except the ones listed in CAUSALITY_PASSWORD_LOGIN_ALLOWLIST (comma-separated,
 * case-insensitive) -- in practice just the Zitadel console's own admin account
 * (zitadel-admin@causalitybio.login.causality.bio). Every invited guest authenticates
 * exclusively through the one-click flow (src/lib/server/invite-redeem.ts); they must never
 * be able to reach a working password check, not even by guessing right, not even by POSTing
 * directly to the password page's server action instead of going through the UI. Enforced in
 * two places, both importing this same list: src/lib/server/loginname.ts (so a guest is never
 * even shown the password page -- routed to /new-device instead) and
 * src/lib/server/password.ts (so a direct request to that server action is refused too,
 * belt-and-braces). See docs/STATUS-phase2.md "2b".
 *
 * Not a "use server" file: this is a plain, synchronous helper, never imported by client
 * code (only by other "use server" modules), so it never needs to cross the server action
 * boundary itself.
 */

const ALLOWLIST = (process.env.CAUSALITY_PASSWORD_LOGIN_ALLOWLIST ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isPasswordLoginAllowed(loginName?: string | null): boolean {
  if (!loginName) return false;
  return ALLOWLIST.includes(loginName.trim().toLowerCase());
}
