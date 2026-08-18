import fs from "fs";
import os from "os";
import path from "path";
import {
  VCS_UNCONFIGURED_REMOTE,
  isVcsRemoteConfigured,
  parseVcsRemoteUrl,
  type VcsPushResult,
  type VcsSyncResult,
  type VcsSyncState
} from "@shared/types/vcs";
import {
  LORE_REMOTE_URL_KEY,
  cloneRepository,
  createRepository,
  pushBranch,
  releaseRepository,
  repositoryConfig,
  repositoryStatus,
  syncRevision,
  type LoreGlobals
} from "./lore";

/**
 * Talking to a server.
 *
 * Everything in this module needs `offline: false` on its globals, and it is the ONLY
 * module in `vcs/` for which that is true. The rest of Studio's version control runs
 * offline by construction (`VcsManager.globalsFor`), which is what keeps a status read
 * in the status bar from ever waiting on a socket.
 *
 * **What "unreachable" costs is measured, not assumed**: an online status against a
 * server that nothing answers on returns `remoteAvailable: false` after **2.03 s**, and
 * a push against the same fails after 2.03 s with a transport error. It does not hang.
 * Two seconds is affordable for something the author asked for and unaffordable for
 * anything on the path of opening a project - which is why nothing here is ever called
 * on its own initiative.
 *
 * Three measured behaviours of the backend shape this file: creating a repository while
 * online creates it ON THE SERVER, the backend stores only the origin of a remote URL,
 * and a diverged push refuses itself with a sentence the author can act on.
 */

/** Lore's own marker directory, and the config file it keeps inside it. */
const REPOSITORY_DIRECTORY = ".lore";
const CONFIG_FILE = "config.toml";

/**
 * The `remote_url` line of a repository's config.
 *
 * Anchored to the start of a line and to the key, so it cannot match the word inside a
 * value or a comment. The `m` flag is what makes `^` mean "start of line" rather than
 * "start of file" - without it this silently matches nothing on every real config, which
 * would leave {@link writeRemote} appending a duplicate key.
 */
const REMOTE_URL_LINE = /^[ \t]*remote_url[ \t]*=.*$/m;

export class RemoteConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteConfigError";
  }
}

function configPath(root: string): string {
  return path.join(root, REPOSITORY_DIRECTORY, CONFIG_FILE);
}

/**
 * The server this project syncs with, or null when it has none.
 *
 * Read through the backend rather than off the file, so it reflects what the backend
 * will actually dial. Both historical placeholders read as null - see
 * `isVcsRemoteConfigured` for why that matters more than it looks.
 *
 * A pure local read: `repository_config_get` does not touch the network, so this is safe
 * to ask with offline globals and safe to ask on opening a panel.
 */
export async function readRemote(globals: LoreGlobals): Promise<string | null> {
  const url = await repositoryConfig(globals, LORE_REMOTE_URL_KEY);
  return isVcsRemoteConfigured(url) ? (url as string).trim() : null;
}

/**
 * Point this repository at a server, or at nothing.
 *
 * **Rewrites one line of the author's `.lore/config.toml` and touches nothing else.**
 * The file is Lore's, not Studio's - it also holds the store budget and the file-io
 * flags, and a future version may hold more - so this replaces the `remote_url` line in
 * place rather than regenerating the file from a template. Regenerating would silently
 * revert settings the author or their `lore` CLI had set.
 *
 * Written through a temporary file and renamed, because a half-written config is a
 * repository the backend cannot open at all.
 *
 * The caller must have released the repository first: the config is read when a store is
 * opened, so rewriting it under a live session gets the old value for the rest of that
 * session. `VcsManager.setRemote` closes the session around this call for that reason.
 */
export async function writeRemote(root: string, url: string | null): Promise<void> {
  const file = configPath(root);
  if (!fs.existsSync(file)) {
    throw new RemoteConfigError(`${root} is not under version control`);
  }

  const trimmed = (url ?? "").trim();
  // Validated here rather than only at the call site, because this is the function that
  // makes the address permanent: an address with no repository name writes a config the
  // backend will later reject, and the author would learn of it at their first push.
  if (trimmed) parseRemoteUrl(trimmed);
  const next = trimmed || VCS_UNCONFIGURED_REMOTE;
  // A quote or newline in the value would break out of the TOML string and could write
  // arbitrary keys into the backend's own config. The author types this into a text
  // box, so it is untrusted input in the only sense that matters here.
  if (/["\r\n\\]/.test(next)) {
    throw new RemoteConfigError(
      "A server address cannot contain quotes, backslashes or line breaks"
    );
  }

  const current = fs.readFileSync(file, "utf-8");
  const line = `remote_url = "${next}"`;
  const updated = REMOTE_URL_LINE.test(current)
    ? current.replace(REMOTE_URL_LINE, line)
    : // Prepended rather than appended: TOML puts bare keys before the first table
      // header, and appending would land the key inside whatever section is last -
      // `[file]` today - where the backend would not find it.
      `${line}\n${current}`;

  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, updated, "utf-8");
  fs.renameSync(temporary, file);
}

/**
 * A server address the author can actually be connected to.
 *
 * The path segment is REQUIRED and is not decoration: measured, it becomes the
 * repository's name on the server, and it is the name a collaborator clones by. A URL
 * without one is also rejected by the backend outright (`parsing repository URL: Invalid
 * URL`), so this catches the same mistake earlier and in words.
 *
 * The rule itself lives in `@shared/types/vcs` because the project wizard applies it too,
 * while it is still a field the author can correct. This wrapper is the throwing form,
 * with the sentence that names what is missing.
 */
export function parseRemoteUrl(url: string): { origin: string; name: string } {
  const parsed = parseVcsRemoteUrl(url);
  if (!parsed) {
    throw new RemoteConfigError(
      "A server address needs a name for this project on it, like" +
        " lore://studio.example.lan:41337/my-game"
    );
  }
  return parsed;
}

/**
 * Register this repository on the server, so that it can be cloned from there.
 *
 * **This step is not optional, and its absence is invisible without it.** Measured: a
 * project created offline and then pointed at a server can PUSH successfully - the call
 * returns, and the status even reports `remoteBranchExists: true` - while remaining
 * unclonable. `repositoryClone` answers `Not found` by name, by repository id, and by the
 * repository's own name alike. So a collaboration set up with push alone looks complete
 * from the pushing side and does not exist from every other side.
 *
 * `repositoryCreate` is the only verb that registers, and it refuses to run in a
 * directory that is already a repository - hence the scratch directory. The `id` argument
 * is what makes that sound rather than a trick: the registration carries THIS project's
 * repository id, so the name on the server resolves to the same repository the author's
 * pushes come from. Verified end to end - after this, push, sync state and a clone by
 * name from a second machine all work and the clone carries the content.
 *
 * The scratch repository is released and deleted; it exists only for the duration of the
 * call.
 */
export async function publishToRemote(
  globals: LoreGlobals,
  options: { url: string; repositoryId: string }
): Promise<void> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nl-vcs-publish-"));
  const scratchGlobals: LoreGlobals = { ...globals, repositoryPath: scratch, offline: false };
  try {
    await createRepository(scratchGlobals, {
      repositoryUrl: options.url,
      id: options.repositoryId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Already registered. The backend distinguishes the two cases for us: it names
    // BOTH ids when they disagree, which is the case the author has to act on (the
    // name is taken by someone else's project). Same id is simply "already done" -
    // and this call has to be safe to repeat, because connecting a second machine to
    // the same server runs it again.
    if (/already exist/i.test(message) && message.includes(options.repositoryId)) {
      return;
    }
    throw error;
  } finally {
    await releaseRepository(scratchGlobals).catch(() => undefined);
    try {
      fs.rmSync(scratch, { recursive: true, force: true });
    } catch {
      // A leftover temp directory is not worth failing a connection over.
    }
  }
}

/**
 * Where this branch stands against its server.
 *
 * **The five sync fields are only true under `offline: false`** - measured: offline they
 * are all false, which is indistinguishable from "there is no server". So this is the
 * one status read that goes online, and it is `scan: false, revisionOnly: true` like
 * every other read on this surface, because a scan is not a pure read (§4.17).
 *
 * Never throws for an unreachable server: that answer is `remoteAvailable: false`, which
 * is information rather than a failure. It costs 2.03 s to learn.
 */
export async function readSyncState(onlineGlobals: LoreGlobals): Promise<VcsSyncState> {
  const { revision } = await repositoryStatus(onlineGlobals, { scan: false, revisionOnly: true });
  return {
    remoteAvailable: revision?.remoteAvailable ?? false,
    remoteAuthorized: revision?.remoteAuthorized ?? false,
    remoteBranchExists: revision?.remoteBranchExist ?? false,
    localAhead: revision?.isLocalAhead ?? false,
    remoteAhead: revision?.isRemoteAhead ?? false,
    remoteRevision: revision?.revisionRemote
  };
}

/**
 * Send this branch's revisions to the server.
 *
 * A diverged branch is refused BY THE BACKEND, with `Branch has diverged, sync to merge
 * remote changes` - measured. That sentence names the next thing the author has to do,
 * so it is passed through rather than replaced: a translated "push failed" would be less
 * useful than the English it hides.
 */
export async function pushToRemote(onlineGlobals: LoreGlobals): Promise<VcsPushResult> {
  const pushed = await pushBranch(onlineGlobals);
  return { branch: pushed.branch, alreadyPushed: pushed.alreadyPushed };
}

/**
 * Bring the server's revisions down into the working tree.
 *
 * **This writes the author's files**, which is why it is the one call here with a
 * precondition the caller must enforce: the working tree has to be clean. Measured
 * behaviour on a diverged branch is an automatic merge producing a new revision, and
 * that merge is only safe to accept while there is nothing uncommitted for it to land
 * on top of.
 *
 * Conflicts are REPORTED, not thrown. A conflicted sync has already written most of the
 * tree, so "it failed" would be a lie; the author needs the file list and to be left in
 * the merge the sync opened.
 *
 * **The returned paths are the only copy of that list the process ever gets.** They come
 * out of the event stream and nothing can ask for them again - `repositoryStatus` reports
 * an empty file list for the whole of a conflicted merge (§4.24). After this call the
 * paths are recovered from disk instead, by `readMergeState` in `merge.ts`.
 */
export async function syncFromRemote(
  onlineGlobals: LoreGlobals,
  options: { onProgress?: (received: number, total: number) => void } = {}
): Promise<VcsSyncResult> {
  const result = await syncRevision(onlineGlobals, {
    onProgress: options.onProgress
      ? (progress) => options.onProgress?.(progress.bytesUpdate, progress.bytesUpdateTotal)
      : undefined
  });

  // **From the event stream, not from the file list.** The per-file sync events have no
  // conflict fields in their struct at all - the decoder writes `false` into them - so
  // the filter this used to run could never match, and every conflicted sync degraded to
  // the "*" placeholder below. The paths come from the merge conflict event the sync
  // emits alongside them (docs/version-control.md §4.24), and the progress counter is
  // still consulted: a count with no paths must not read as a clean sync.
  const conflicts = result.conflicts;
  const conflicted = (result.progress?.fileConflict ?? 0) > 0 || conflicts.length > 0;

  return {
    filesChanged: result.files.length,
    revisionsReceived: result.revisions.length,
    conflicts:
      conflicted && conflicts.length === 0
        ? // The count said yes but no path came with it. Naming nothing is better than
          // naming the wrong file, and the caller still has to stop.
          ["*"]
        : conflicts,
    alreadyCurrent: result.files.length === 0 && result.revisions.length === 0
  };
}

/** A destination that cannot safely receive a clone, with the reason. */
export class CloneDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneDestinationError";
  }
}

/**
 * Copy a repository from a server into a local directory.
 *
 * **The emptiness check is Studio's, not the backend's.** Lore writes `.lore/` and the
 * whole working tree into the destination without asking, so pointing a clone at a
 * directory that already holds work would overwrite it. The guard is here rather than in
 * the caller because every caller would need it and one of them would forget.
 *
 * A directory that does not exist is created; one that exists must be empty. Both are
 * ordinary author choices from a folder picker.
 */
export async function cloneInto(
  onlineGlobals: LoreGlobals,
  options: { repositoryUrl: string; onProgress?: (transferred: number, total: number) => void }
): Promise<{ branch: string; fileCount: number }> {
  const destination = onlineGlobals.repositoryPath;

  if (fs.existsSync(destination)) {
    if (!fs.statSync(destination).isDirectory()) {
      throw new CloneDestinationError(`${destination} is not a folder`);
    }
    if (fs.readdirSync(destination).length > 0) {
      throw new CloneDestinationError(`${destination} is not empty`);
    }
  } else {
    fs.mkdirSync(destination, { recursive: true });
  }

  const cloned = await cloneRepository(onlineGlobals, {
    repositoryUrl: options.repositoryUrl,
    onProgress: options.onProgress
      ? (count) => options.onProgress?.(count.bytesTransferred, count.bytesTotal)
      : undefined
  });
  return { branch: cloned.branch, fileCount: cloned.fileCount };
}
