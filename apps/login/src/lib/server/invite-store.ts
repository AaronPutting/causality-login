"use server";

/**
 * One-click invite tokens: Causality.bio's own addition, not part of upstream Login V2.
 *
 * Record format is a tiny shared contract with causality-auth's tools/invite.py (a different
 * repo, a different language, writing the same directory): one JSON file per invite, named
 * `sha256(token).json`, holding everything needed to complete the session EXCEPT the token
 * itself -- knowing the raw token is exactly what lets a caller compute the right filename, so
 * nothing is gained by also storing it inside the file, and it means this directory never
 * holds a plaintext bearer credential even if it ends up in a backup.
 *
 * Single-use is enforced with `fs.rename` to a `.used` sibling: rename is atomic on the same
 * filesystem, so two concurrent redemptions (a double click, a retried POST) can never both
 * see "not yet claimed" -- exactly one rename call succeeds, the other gets ENOENT.
 *
 * The directory (CAUSALITY_INVITE_STORE_DIR, bind-mounted from the host) is created world
 * read/write/execute (0777) by run.sh: tools/invite.py runs directly on the host as `aaron`,
 * this container runs as `nextjs` (uid 1001), and `rename`/`unlink` permission comes from the
 * *directory's* write bit, not the file's own owner or mode. The records themselves carry no
 * secret (email, name, target page, timestamps only), so a world-writable directory is an
 * acceptable, deliberate tradeoff for a pilot-scale, single-host setup -- not a pattern to
 * reuse for anything that holds a credential.
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

/** Read-only check, safe to call from a GET: never consumes the invite. */
export async function peekInvite(token: string): Promise<PeekResult> {
  if (!token) return { status: "not_found" };
  const file = fileFor(token);

  const record = await readRecord(file);
  if (record) {
    return isExpired(record) ? { status: "expired" } : { status: "ok", record };
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

  return { status: "ok", record };
}
