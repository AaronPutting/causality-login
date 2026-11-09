"use server";

/**
 * One-click invite tokens: Causality.bio's own addition, not part of upstream Login V2.
 *
 * Record format is a tiny shared contract with causality-auth's tools/invite.py (a different
 * repo, a different language, writing the same directory): one JSON file per invite, named
 * `sha256(token).json`, holding everything needed to complete the session, including a
 * `password` field -- see tools/invite.py's `set_invite_password` for why that exists and
 * invite-redeem.ts's top comment for how it is used.
 *
 * SECURITY (found and fixed 2026-11-07, docs/STATUS-phase2.md "2b"): a used record used to
 * keep that password verbatim in its `.used` sibling forever, in a world-writable directory.
 * The *token* going dead on redemption (below) does not make the *password* go dead too --
 * password login, unlike the token, has no single-use concept of its own, so the earlier
 * design meant anyone who could read that directory could keep signing in as the guest until
 * Aaron happened to invite them again. Two independent fixes, both applied, not an either/or:
 * (1) `claimInvite` below now overwrites the `.used` file's content to drop the `password`
 * field, immediately after the atomic rename that claims it; (2) `invite-redeem.ts` rotates
 * the user's actual Zitadel password to a fresh, never-stored value right after confirming
 * the session, so even a reader fast enough to catch the brief window in (1) gets a password
 * that no longer works. Expired records (live or already-used) are deleted outright, both
 * opportunistically here (`peekInvite`/`claimInvite`) and by a periodic sweep
 * (`tools/invite.py --cleanup`, wired into the nightly backup cron) -- a record with nothing
 * left to protect is still a record naming a real person, no reason to keep it past its TTL.
 *
 * Single-use is enforced with `fs.rename` to a `.used` sibling: rename is atomic on the same
 * filesystem, so two concurrent redemptions (a double click, a retried POST) can never both
 * see "not yet claimed" -- exactly one rename call succeeds, the other gets ENOENT.
 *
 * The directory (CAUSALITY_INVITE_STORE_DIR, bind-mounted from the host) is owned by `aaron`
 * (gid 1000) with the setgid bit (mode 2770, see run.sh): tools/invite.py runs directly on
 * the host as `aaron`, this container is given that same gid as a supplementary group
 * (`group_add` in docker-compose.yml) so it can create/rename/read files via the group bits
 * without the directory or its files (mode 0660) being readable or writable by anyone else on
 * the host. Not world-writable any more -- that was never required for the uid mismatch, only
 * convenient; see docs/STATUS-phase2.md "2b" for the full before/after.
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type InviteRecord = {
  userId: string;
  loginName: string;
  organization?: string;
  email: string;
  name: string;
  page: string;
  // Which deployed site this invite redirects to once redeemed, e.g. "lab" or "lab-next".
  // Optional for backward compatibility with records written before this field existed, and
  // because tools/invite.py's own --site flag defaults it on write anyway. invite-redeem.ts
  // maps it through a fixed allow list and treats a missing or unrecognized value as "lab",
  // never as an open redirect -- see that file's SITE_ORIGINS.
  site?: string;
  password: string;
  createdAt: string; // ISO
  expiresAt: string; // ISO
};

export type PeekResult =
  | { status: "ok"; record: InviteRecord }
  | { status: "used" }
  | { status: "expired" }
  | { status: "not_found" };

export type ClaimResult = PeekResult; // same shape; "ok" means this call just claimed it

function storeDir(): string {
  return process.env.CAUSALITY_INVITE_STORE_DIR || "/data/invites";
}

function fileFor(token: string): string {
  const digest = createHash("sha256").update(token, "utf8").digest("hex");
  return path.join(storeDir(), `${digest}.json`);
}

async function readRecord(file: string): Promise<InviteRecord | undefined> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as InviteRecord;
  } catch (err: any) {
    if (err?.code === "ENOENT") return undefined;
    throw err;
  }
}

function isExpired(record: InviteRecord): boolean {
  return new Date(record.expiresAt).getTime() <= Date.now();
}

/** Best-effort delete; a concurrent cleanup or redemption already removing the same file is
 * not an error here, there is nothing left to do either way. */
async function unlinkQuiet(file: string): Promise<void> {
  await fs.unlink(file).catch(() => {});
}

/** Read-only check, safe to call from a GET: never consumes the invite, but does delete an
 * expired record outright (nothing left in it worth protecting, no reason to keep naming a
 * real person on disk past its own TTL). */
export async function peekInvite(token: string): Promise<PeekResult> {
  if (!token) return { status: "not_found" };
  const file = fileFor(token);

  const record = await readRecord(file);
  if (record) {
    if (isExpired(record)) {
      await unlinkQuiet(file);
      return { status: "expired" };
    }
    return { status: "ok", record };
  }

  // Not found as a live record -- it may be an already-claimed one. Distinguish "used" from
  // "never existed" only insofar as the .used marker is present, so the page can still say
  // the more specific "this link was already used" when that's actually what happened.
  const usedExists = await fs
    .access(`${file}.used`)
    .then(() => true)
    .catch(() => false);
  return usedExists ? { status: "used" } : { status: "not_found" };
}

/** Consumes the invite exactly once. Only call this from the POST/redeem path. */
export async function claimInvite(token: string): Promise<ClaimResult> {
  if (!token) return { status: "not_found" };
  const file = fileFor(token);

  const record = await readRecord(file);
  if (!record) {
    const peeked = await peekInvite(token);
    return peeked.status === "ok" ? { status: "not_found" } : peeked;
  }
  if (isExpired(record)) {
    await unlinkQuiet(file);
    return { status: "expired" };
  }

  try {
    await fs.rename(file, `${file}.used`);
  } catch (err: any) {
    // Lost the race to another concurrent redeem (or a prior one already happened): treat as
    // used either way, never silently re-grant a session.
    if (err?.code === "ENOENT") return { status: "used" };
    throw err;
  }

  // SECURITY: the password's job ended the instant the rename above succeeded -- strip it
  // from the file that now sits on disk indefinitely. The in-memory `record` returned below
  // still has it, which is fine (and necessary: invite-redeem.ts needs it for this one
  // session check, and also rotates the live Zitadel password right after using it). Best
  // effort: if this write fails, the record is still correctly claimed (single-use holds
  // either way), just logged nowhere today -- a stale password sitting a little longer in a
  // 0660 file only this host's own invite tooling can read is a far smaller exposure than the
  // world-readable version this replaces, and the password rotation in invite-redeem.ts is
  // the fix that does not depend on this write succeeding at all.
  const { password: _password, ...sanitized } = record;
  await fs.writeFile(`${file}.used`, JSON.stringify(sanitized), { mode: 0o660 }).catch(() => {});

  return { status: "ok", record };
}
