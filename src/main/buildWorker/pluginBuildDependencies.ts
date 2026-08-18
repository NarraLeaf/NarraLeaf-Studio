import { createHash } from "crypto";
import type { Dirent } from "fs";
import fs from "fs/promises";
import path from "path";
import type { PluginBuildDependencyTargetContribution } from "@shared/types/plugins";
import type { DownloadRewriteRule } from "@shared/types/downloadSource";
import { describeRewrite, rewriteDownloadUrl } from "@shared/utils/downloadSource";
import {
  parseZipIndex,
  readEntryBytes,
  type ZipIndex,
  type ZipIndexEntry
} from "./mobile/zipModel";

/**
 * Fetches, verifies and caches the external binaries a plugin declares in
 * `contributes.buildDependencies` - redistributables whose license lets the
 * *game* ship them but does not let a public plugin registry mirror them.
 *
 * Shaped after `ensureWinCodeSignCache`: fetch -> verify the digest -> write a
 * staging directory -> atomic rename. A hit never touches the network, and a
 * failed verification leaves nothing behind under the cache key, so a poisoned
 * download can never be mistaken for a good one on the next build.
 *
 * Deliberately electron-free: the artifact compile (and therefore this) runs
 * off the main process in the build worker, so the caller passes userData in.
 *
 * Layout under `<userData>/cache/build-deps/<sha256>/`:
 *
 *   source                     the verified bytes exactly as downloaded
 *   out/<layout>/              the produced dependency directory
 *   out/<layout>.sha256.json   what the extraction wrote there, so a later build
 *                              can tell that directory from one something else
 *                              has since written into
 *
 * The cache key is the content digest, not the URL, so re-pointing a URL at
 * identical bytes never re-downloads. `source` is kept beside the produced
 * directory for two reasons: it is the single file an author drops in by hand
 * to build with no network (see `buildDependencySourcePath`), and it lets a
 * changed `files` mapping be re-extracted without downloading again. That
 * mapping is what `<layout>` keys - two targets can share one archive and lay
 * it out differently, and an author who adds a file to `files` must not get a
 * stale directory that silently lacks it.
 */

export type BuildDependencyLog = (level: "info" | "warning" | "error", message: string) => void;

export type PluginBuildDependencyRequest = {
  /** Electron's userData directory, passed in so this module stays main-process-free. */
  userDataDir: string;
  /** `contributes.buildDependencies[].id`; only used to name the thing in errors and logs. */
  dependencyId: string;
  /** The platform key this target was declared under, likewise for messages. */
  platformKey: string;
  target: PluginBuildDependencyTargetContribution;
  /**
   * The author's download rewrites, handed over rather than read - this runs in the build
   * worker, which has no Electron and no global state (same reason `userDataDir` is a
   * parameter). Absent means no rewriting, which is what every existing caller gets.
   *
   * This is the safest place in Studio for a rewrite: the bytes are pinned to a declared
   * sha256 and a mismatch caches nothing, so a mirror can only serve the declared archive or
   * fail loudly.
   */
  rewrites?: readonly DownloadRewriteRule[];
  log?: BuildDependencyLog;
};

const CACHE_DIR_NAME = "cache";
const CACHE_BUCKET_NAME = "build-deps";
/** Name the raw download takes in the cache; stable because the URL is not the key. */
const SOURCE_FILE_NAME = "source";
const ARTIFACT_DIR_NAME = "out";
/** Suffix of the digest record, appended to the artifact directory's own path. */
const ARTIFACT_RECORD_SUFFIX = ".sha256.json";
/** A record this version does not recognise counts as none: extract, then overwrite it. */
const ARTIFACT_RECORD_VERSION = 1;
/** Enough top-level names to orient an author without pasting a whole archive listing. */
const MAX_LISTED_ARCHIVE_ENTRIES = 24;
/** A reachability probe answers in well under this; the build dialog waits on it. */
const PROBE_TIMEOUT_MS = 5000;

/** Distinguishes concurrent staging directories within one process. */
let stagingSequence = 0;

export function buildDependencyCacheRoot(userDataDir: string): string {
  return path.join(userDataDir, CACHE_DIR_NAME, CACHE_BUCKET_NAME);
}

/** Everything cached for one set of bytes, whatever plugin or URL asked for them. */
export function buildDependencyCacheDir(userDataDir: string, sha256: string): string {
  return path.join(buildDependencyCacheRoot(userDataDir), sha256.trim().toLowerCase());
}

/**
 * Where an author saves the file by hand when the build host cannot reach the
 * network. The build verifies whatever it finds there against the declared
 * digest, so a wrong file fails loudly instead of shipping.
 */
export function buildDependencySourcePath(userDataDir: string, sha256: string): string {
  return path.join(buildDependencyCacheDir(userDataDir, sha256), SOURCE_FILE_NAME);
}

/**
 * Resolve a path inside a produced dependency directory - what `dep:<id>/<path>`
 * includes point at. Refuses to escape, so a hand-edited manifest cannot reach
 * outside the cache.
 */
export function resolveBuildDependencyFile(dependencyDir: string, relativePath: string): string {
  const root = path.resolve(dependencyDir);
  const segments = normalizeArchivePath(relativePath)
    .split("/")
    .filter((segment) => segment.length > 0);
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Build dependency path escapes its directory: ${relativePath}`);
  }
  return resolved;
}

/**
 * The produced dependency directory for one target, downloading and unpacking
 * it if this host has not done so before. Returns an absolute path.
 *
 * A hit is re-verified rather than assumed: these bytes are copied into a game
 * that ships to players, and the directory holding them is an ordinary folder
 * under userData that anything on this host can rewrite between builds. The
 * package-relative half of the same `include` syntax already re-hashes at pack
 * time for exactly that reason (see `resolveSidecarInclude`); pinning the
 * archive says nothing about what is in the directory it was unpacked into.
 */
export async function ensurePluginBuildDependency(
  input: PluginBuildDependencyRequest
): Promise<string> {
  const { userDataDir, target, log } = input;
  const where = describeTarget(input);
  const dependencyDir = buildDependencyCacheDir(userDataDir, target.sha256);
  const artifactDir = path.join(dependencyDir, ARTIFACT_DIR_NAME, layoutKey(target));
  const recordPath = `${artifactDir}${ARTIFACT_RECORD_SUFFIX}`;

  const recorded = await readArtifactRecord(recordPath);
  if (recorded) {
    const verdict = await verifyArtifactDir(artifactDir, recorded);
    if (verdict.status === "verified") {
      return artifactDir;
    }
    // Not a build failure, deliberately: `source` beside it is pinned to the
    // declared digest, so extracting again yields bytes this build knows,
    // and refusing would only ask an author to delete a folder the build can
    // rebuild itself. Worth saying out loud all the same - a directory that
    // stopped matching is either a half-written cache or something writing
    // where nothing should, and neither is silent-worthy.
    log?.(
      "warning",
      `${where}: ${artifactDir} is no longer what was extracted into it (${verdict.reason}); ` +
        "re-extracting it from the verified source"
    );
  }

  const source =
    (await readCachedSource(dependencyDir, target.sha256, where)) ??
    (await downloadSource(input, dependencyDir, where));

  const stagingDir = `${dependencyDir}.out-staging-${process.pid}-${stagingSequence++}`;
  try {
    await fs.mkdir(stagingDir, { recursive: true });
    const digests: ArtifactDigests = {};
    if (target.archive === "none") {
      await writeArtifactFile(stagingDir, target.fileName, source, digests);
    } else {
      await extractMappedEntries(source, target.files, stagingDir, where, digests);
    }
    await installArtifactDir({ stagingDir, artifactDir, digests, where });
    await writeArtifactRecord(recordPath, digests);
    log?.("info", `${where} ready at ${artifactDir}`);
    return artifactDir;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type BuildDependencyAvailability =
  /** Already on disk: the build needs no network for it. */
  | { status: "cached" }
  /** Not cached, but the host answered - the build can fetch it. */
  | { status: "reachable" }
  | { status: "unavailable"; reason: string };

/**
 * Whether a build could obtain this dependency, cheaply enough to run while the
 * build dialog is open.
 *
 * Deliberately not `ensurePluginBuildDependency`: preflight must not pull tens
 * of megabytes just to render a dialog. A HEAD that gets any HTTP response
 * proves the host is there, so only a transport failure or a hard "not there"
 * status blocks - a CDN that rejects HEAD with 405 says nothing about whether
 * the bytes exist, and guessing "unavailable" from it would cry wolf.
 */
export async function probePluginBuildDependency(input: {
  userDataDir: string;
  target: PluginBuildDependencyTargetContribution;
  /** Same rules the download will use, so the dialog probes the host a build would reach. */
  rewrites?: readonly DownloadRewriteRule[];
  timeoutMs?: number;
}): Promise<BuildDependencyAvailability> {
  const { userDataDir, target } = input;
  const dependencyDir = buildDependencyCacheDir(userDataDir, target.sha256);
  if (await exists(path.join(dependencyDir, ARTIFACT_DIR_NAME, layoutKey(target)))) {
    return { status: "cached" };
  }
  if (await exists(path.join(dependencyDir, SOURCE_FILE_NAME))) {
    return { status: "cached" };
  }
  try {
    const response = await fetch(rewriteDownloadUrl(target.url, input.rewrites ?? []).url, {
      method: "HEAD",
      signal: AbortSignal.timeout(input.timeoutMs ?? PROBE_TIMEOUT_MS)
    });
    if (response.status === 404 || response.status === 410) {
      return { status: "unavailable", reason: `HTTP ${response.status}` };
    }
    return { status: "reachable" };
  } catch (error) {
    return { status: "unavailable", reason: messageOf(error) };
  }
}

/* --------------------------------------------------------------- internals */

function describeTarget(
  input: Pick<PluginBuildDependencyRequest, "dependencyId" | "platformKey">
): string {
  return `Build dependency "${input.dependencyId}" (${input.platformKey})`;
}

/**
 * Identifies how a target lays the archive out, so two targets sharing one set
 * of bytes get one download and a produced directory each.
 */
function layoutKey(target: PluginBuildDependencyTargetContribution): string {
  const canonical =
    target.archive === "none"
      ? JSON.stringify(["none", target.fileName])
      : JSON.stringify([
          "zip",
          Object.entries(target.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The cached bytes, re-verified. A manually placed file is untrusted input like
 * any download, and a build that silently accepted the wrong one would ship it.
 */
async function readCachedSource(
  dependencyDir: string,
  sha256: string,
  where: string
): Promise<Buffer | null> {
  const sourcePath = path.join(dependencyDir, SOURCE_FILE_NAME);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(sourcePath);
  } catch {
    return null;
  }
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== sha256.trim().toLowerCase()) {
    throw new Error(
      `${where}: the cached file at ${sourcePath} has sha256 ${digest}, not the declared ` +
        `${sha256.trim().toLowerCase()}; delete it and let the build fetch it again`
    );
  }
  return buffer;
}

async function downloadSource(
  input: PluginBuildDependencyRequest,
  dependencyDir: string,
  where: string
): Promise<Buffer> {
  const { target, log } = input;
  // Errors keep naming the DECLARED url, not the rewritten one: that is the address the
  // plugin author published and the one the reader can look up. The rewrite is stated on its
  // own line instead, so a mirror serving the wrong thing is still traceable.
  const outcome = rewriteDownloadUrl(target.url, input.rewrites ?? []);
  const rewriteLine = describeRewrite(target.url, outcome);
  log?.("info", `${where}: downloading ${target.url}`);
  if (rewriteLine) {
    log?.("info", `${where}: ${rewriteLine}`);
  }
  const response = await fetch(outcome.url).catch((error: unknown) => {
    throw new Error(`${where}: could not download ${target.url} (${messageOf(error)})`);
  });
  if (!response.ok) {
    throw new Error(`${where}: download of ${target.url} failed with HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(buffer).digest("hex");
  const expected = target.sha256.trim().toLowerCase();
  if (digest !== expected) {
    // Nothing under the cache key has been created yet, so there is no
    // half-written directory for the next build to trust.
    throw new Error(
      `${where}: ${target.url} has sha256 ${digest}, not the declared ${expected}; nothing was cached`
    );
  }

  const stagingPath = `${dependencyDir}.source-staging-${process.pid}-${stagingSequence++}`;
  try {
    await fs.mkdir(path.dirname(dependencyDir), { recursive: true });
    await fs.writeFile(stagingPath, buffer);
    await fs.mkdir(dependencyDir, { recursive: true });
    try {
      await fs.rename(stagingPath, path.join(dependencyDir, SOURCE_FILE_NAME));
    } catch (error) {
      if (!(await exists(path.join(dependencyDir, SOURCE_FILE_NAME)))) {
        throw error;
      }
    }
  } finally {
    await fs.rm(stagingPath, { force: true }).catch(() => undefined);
  }
  return buffer;
}

/** Every file one extraction produced, keyed by its path inside the artifact directory. */
type ArtifactDigests = Record<string, string>;

type ArtifactVerdict =
  | { status: "verified" }
  /** Says which file and how, because the log line is all an author will see. */
  | { status: "changed"; reason: string };

/**
 * Whether an artifact directory still holds exactly what was extracted into it.
 *
 * Digests recorded at extraction time rather than re-extracting on every build:
 * the directory is a cache that outlives builds, a dependency runs to tens of
 * megabytes, and every Run reaches this path - hashing the handful of files an
 * author mapped is one read, while re-extracting is a read, an inflate and a
 * write. The record can be wrong about nothing, because it is a pure function
 * of the pinned source bytes and the target's `files` mapping, and the path it
 * sits at already keys both: two builds racing write identical bytes, a record
 * that is absent or unreadable only costs the next build an extraction, and
 * there is never anything to migrate.
 *
 * Extra files count as a change too. `dep:<id>/<path>` includes are not limited
 * to the mapping's outputs, so a file that was never extracted here is a file
 * this cache cannot vouch for.
 */
async function verifyArtifactDir(
  artifactDir: string,
  recorded: ArtifactDigests
): Promise<ArtifactVerdict> {
  const found = new Set<string>();
  const pending = [""];
  while (pending.length > 0) {
    const relative = pending.pop() as string;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(path.join(artifactDir, relative), { withFileTypes: true });
    } catch (error) {
      // Also how a lost race reads from here: a concurrent build renaming
      // its own directory into place makes this vanish for an instant.
      // "Cannot vouch for it" is the honest answer either way, and it
      // costs an extraction rather than a build.
      return {
        status: "changed",
        reason: `${relative || "."} could not be read (${messageOf(error)})`
      };
    }
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        pending.push(child);
      } else if (entry.isFile()) {
        found.add(child);
      } else {
        // A symlink's bytes would hash to whatever it points at today.
        return { status: "changed", reason: `${child} is not a regular file` };
      }
    }
  }
  for (const relative of found) {
    if (!(relative in recorded)) {
      return { status: "changed", reason: `${relative} was added after it was extracted` };
    }
  }
  for (const [relative, expected] of Object.entries(recorded)) {
    if (!found.has(relative)) {
      return { status: "changed", reason: `${relative} is missing` };
    }
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(path.join(artifactDir, ...relative.split("/")));
    } catch (error) {
      return { status: "changed", reason: `${relative} could not be read (${messageOf(error)})` };
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== expected) {
      return {
        status: "changed",
        reason: `${relative} has sha256 ${digest}, not the extracted ${expected}`
      };
    }
  }
  return { status: "verified" };
}

async function readArtifactRecord(recordPath: string): Promise<ArtifactDigests | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(recordPath, "utf-8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as { version?: unknown; files?: unknown };
  if (
    record.version !== ARTIFACT_RECORD_VERSION ||
    !record.files ||
    typeof record.files !== "object"
  ) {
    return null;
  }
  const digests: ArtifactDigests = {};
  for (const [relative, digest] of Object.entries(record.files as Record<string, unknown>)) {
    if (typeof digest !== "string") {
      return null;
    }
    digests[relative] = digest;
  }
  return digests;
}

/**
 * Best-effort on purpose: a record that could not be written costs the next
 * build an extraction, which is not worth failing a build over. Written through
 * a staging file so a reader never parses half of one.
 */
async function writeArtifactRecord(recordPath: string, digests: ArtifactDigests): Promise<void> {
  const stagingPath = `${recordPath}.staging-${process.pid}-${stagingSequence++}`;
  try {
    await fs.writeFile(
      stagingPath,
      `${JSON.stringify({ version: ARTIFACT_RECORD_VERSION, files: digests })}\n`
    );
    await fs.rename(stagingPath, recordPath);
  } catch {
    await fs.rm(stagingPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Move a staged extraction into place, over whatever is already there.
 *
 * The plain case is a rename, as it always was. When something occupies the
 * path, the two possibilities are a concurrent build that got there first and a
 * directory this call set out to replace - and they are told apart by the same
 * digests, not by assumption: identical source bytes through an identical
 * mapping produce identical files, so a rival build's directory verifies
 * against ours and is kept.
 */
async function installArtifactDir(input: {
  stagingDir: string;
  artifactDir: string;
  digests: ArtifactDigests;
  where: string;
}): Promise<void> {
  const { stagingDir, artifactDir, digests, where } = input;
  await fs.mkdir(path.dirname(artifactDir), { recursive: true });
  try {
    await fs.rename(stagingDir, artifactDir);
    return;
  } catch (error) {
    if (!(await exists(artifactDir))) {
      throw error;
    }
  }
  if ((await verifyArtifactDir(artifactDir, digests)).status === "verified") {
    return;
  }
  // Renaming onto a non-empty directory is an error on every platform, so the
  // stale one moves aside first. It is discarded rather than kept: it holds
  // bytes no one can account for.
  const discardDir = `${artifactDir}.stale-${process.pid}-${stagingSequence++}`;
  let swapError: unknown;
  try {
    await fs.rename(artifactDir, discardDir);
    await fs.rename(stagingDir, artifactDir);
  } catch (error) {
    swapError = error;
  }
  await fs.rm(discardDir, { recursive: true, force: true }).catch(() => undefined);
  if (!swapError) {
    return;
  }
  // A build that lost the race mid-swap can still be right; anything else
  // leaves bytes at this path that nothing has vouched for, and those must not
  // reach a game.
  if ((await verifyArtifactDir(artifactDir, digests)).status === "verified") {
    return;
  }
  throw new Error(
    `${where}: ${artifactDir} holds files that are not the ones extracted from the declared archive, ` +
      `and it could not be replaced (${messageOf(swapError)}); delete that directory and build again`
  );
}

async function writeArtifactFile(
  root: string,
  relativePath: string,
  bytes: Buffer,
  digests: ArtifactDigests
): Promise<void> {
  const target = resolveBuildDependencyFile(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  // Keyed by where the file landed rather than by what was declared: the two
  // differ whenever a mapping spells a path with `.` or a backslash, and the
  // verification walk can only see the former.
  digests[path.relative(root, target).split(path.sep).join("/")] = createHash("sha256")
    .update(bytes)
    .digest("hex");
}

async function extractMappedEntries(
  archive: Buffer,
  files: Record<string, string>,
  root: string,
  where: string,
  digests: ArtifactDigests
): Promise<void> {
  let index: ZipIndex;
  try {
    index = parseZipIndex(archive);
  } catch (error) {
    throw new Error(`${where}: the downloaded file is not a readable zip (${messageOf(error)})`);
  }
  const byName = new Map<string, ZipIndexEntry>();
  for (const entry of index.entries) {
    if (!entry.isDirectory) {
      byName.set(normalizeArchivePath(entry.name), entry);
    }
  }
  for (const [inner, output] of Object.entries(files)) {
    const key = normalizeArchivePath(inner);
    const entry = byName.get(key);
    if (!entry) {
      throw new Error(describeMissingEntry(where, inner, key, index.entries));
    }
    await writeArtifactFile(root, output, readEntryBytes(archive, entry), digests);
  }
}

/** Zip stores forward slashes, but authors copy paths off a Windows shell. */
function normalizeArchivePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "");
}

/**
 * A `files` key that matches nothing is an authoring mistake, and the only way
 * to fix it is to know what the archive actually holds - so say so.
 */
function describeMissingEntry(
  where: string,
  inner: string,
  key: string,
  entries: ZipIndexEntry[]
): string {
  const prefix = `${key}/`;
  if (entries.some((entry) => normalizeArchivePath(entry.name).startsWith(prefix))) {
    return `${where}: "${inner}" is a directory in the archive; map the files inside it individually`;
  }
  const topLevel = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeArchivePath(entry.name);
    if (!normalized) {
      continue;
    }
    const separator = normalized.indexOf("/");
    topLevel.add(separator === -1 ? normalized : `${normalized.slice(0, separator)}/`);
  }
  const listed = [...topLevel].sort();
  const shown = listed.slice(0, MAX_LISTED_ARCHIVE_ENTRIES).join(", ");
  const suffix =
    listed.length > MAX_LISTED_ARCHIVE_ENTRIES ? `, … (${listed.length} in total)` : "";
  return `${where}: the archive has no entry "${inner}"; its top-level entries are: ${shown || "(none)"}${suffix}`;
}
