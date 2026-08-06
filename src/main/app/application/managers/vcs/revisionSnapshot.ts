import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import type { RevisionId } from "@shared/types/vcs";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { isVersioned } from "@shared/vcs/workingSet";
// Type-only, and it has to stay that way: `revisionReader` reaches the native library at module
// scope, and this module is imported by Dev Mode on hosts that have no Lore build at all.
import type { RevisionFileEntry } from "./revisionReader";
import { formatBytes } from "@shared/utils/formatBytes";

/**
 * One revision, written out as an ordinary project directory.
 *
 * This exists because of a shape rather than a preference: `devMode/pipeline/bundleAssembler.ts` is
 * entirely path-driven - about a dozen read points, every one of them `path.join(context.projectPath,
 * ...)` - so "run the revision the author is looking at" is answered by handing the compile path a
 * different directory, not by teaching it what a revision is.
 *
 * Three properties are load-bearing.
 *
 * **It lives where the repository cannot see it.** `.nlstudio/` is excluded by {@link isVersioned},
 * so a snapshot underneath it never appears in the author's change list. Anywhere inside the working
 * set and running an old version would look exactly like an edit the author did not make.
 *
 * **It is keyed by revision and replaced, not accumulated.** At most one Dev Mode session exists per
 * project (`DevModeManager.sessions`, and a launch terminates the previous one), so at most one
 * snapshot is ever in use; a directory per revision that survived would leave a full copy of the
 * project's documents behind for every version the author ever ran, with nothing anywhere to delete
 * them. The name still carries the revision so a stray directory says which one it is.
 *
 * **The bytes come from the repository, never from the working tree.** No hardlink, no copy-if-same,
 * no mtime comparison: a snapshot that shares a file whose content differs from the revision is a
 * wrong build that looks right, which is the single failure this whole milestone exists to prevent.
 */

/** Where every snapshot for one project lives. Under `.nlstudio/`, which is not versioned. */
export function revisionSnapshotsRoot(projectPath: string): string {
    return path.join(projectPath, ".nlstudio", "devmode", "revisions");
}

/**
 * How much of a revision id names its directory.
 *
 * Not the whole 64-hex id: the snapshot's deepest paths are the project's own
 * (`editor/story/stories/<uuid>/storydoc.json`) with this prefix added on top, and Windows still
 * enforces MAX_PATH for plenty of APIs. Sixteen hex characters cannot collide by accident, and a
 * deliberate collision would only cause the directory to be rebuilt - which it is on every launch.
 */
const REVISION_DIRECTORY_LENGTH = 16;

/** The directory one revision materialises into. */
export function revisionSnapshotDirectory(projectPath: string, revision: RevisionId): string {
    return path.join(revisionSnapshotsRoot(projectPath), revision.slice(0, REVISION_DIRECTORY_LENGTH));
}

/**
 * Repository-relative prefix of the author's asset bytes.
 *
 * Deliberately NOT materialised, and this is the one place the snapshot is not a faithful copy:
 *
 *  - **Nothing in the compile path opens one.** The bundle carries asset *ids*; the only bytes it
 *    reads out of `assets/content/` are shared blueprints, which are handled below.
 *  - **Nothing would read them if they were there.** The Dev Mode window resolves asset URLs by
 *    asking its *workspace* window (`DevModeResolveAssetUrlHandler`), which serves the working tree.
 *    So the copy would cost the whole art budget of the project on every launch and change nothing -
 *    on the two-revision fixture that is 74MB of media against 1.6MB of documents.
 *
 * The consequence is the same one the editor already documents for a revision view (plan
 * 2026-07-28-002 §4.2.3, point 3): **the documents are historical and the asset bytes are current.**
 * A sprite the author has since replaced shows its new art. Making that historical too means routing
 * asset resolution through the revision, which is a renderer change and a milestone of its own.
 */
const MEDIA_PREFIX = "assets/content/";

/** The shard naming the blueprint assets the compile path really does read out of `assets/content/`. */
const BLUEPRINT_METADATA_PATH = "assets/assets.metadata.blueprint.json";

export interface RevisionSnapshotSource {
    /** Every file at the revision, with the content address of each. One tree walk. */
    list(): Promise<RevisionFileEntry[]>;
    /** The bytes of one enumerated entry. */
    read(entry: RevisionFileEntry): Promise<Buffer>;
}

export interface RevisionSnapshotResult {
    directory: string;
    files: number;
    bytes: number;
    /** Media left in the repository - see {@link MEDIA_PREFIX}. */
    skippedFiles: number;
    skippedBytes: number;
    durationMs: number;
}

/**
 * Write one revision into its snapshot directory and answer what it cost.
 *
 * The source is a port rather than a Lore session so this module stays free of the native binding
 * (see the type-only import above) and so the policy below can be tested without a repository.
 */
export async function materializeRevisionSnapshot(options: {
    projectPath: string;
    revision: RevisionId;
    source: RevisionSnapshotSource;
    /** Progress, for a launch that would otherwise look hung. */
    onProgress?: (message: string) => void;
}): Promise<RevisionSnapshotResult> {
    const started = Date.now();
    // Resolved once, because it is the boundary every write below is checked against.
    const directory = path.resolve(revisionSnapshotDirectory(options.projectPath, options.revision));

    // Everything, not just this revision's directory: a snapshot left behind by a crash has no owner
    // and nothing else would ever remove it. Cheap, because there is at most one.
    //
    // And it must succeed. Materialising on top of files left from another run would produce a MIXED
    // tree - some documents from the revision, some from whatever was there before - which is the
    // "wrong build that looks right" this whole module is written to avoid. Refusing hands the launch a
    // failure it turns into a refusal the author can read.
    if (!await removeRevisionSnapshots(options.projectPath)) {
        throw new Error(
            `Could not clear the previous Dev Mode snapshot at ${revisionSnapshotsRoot(options.projectPath)}`,
        );
    }
    await fs.mkdir(directory, { recursive: true });

    const entries = await options.source.list();
    const { documents, media } = partitionSnapshotEntries(entries);
    options.onProgress?.(
        `materialising revision ${options.revision.slice(0, 12)}: ${documents.length} document(s)`,
    );

    let files = 0;
    let bytes = 0;
    let blueprintShard: Buffer | undefined;
    for (const entry of documents) {
        const written = await writeEntry(directory, entry, await options.source.read(entry));
        if (entry.path === BLUEPRINT_METADATA_PATH) {
            blueprintShard = written;
        }
        files += 1;
        bytes += written.length;
    }

    // Shared blueprints are the exception to MEDIA_PREFIX: `loadSharedBlueprints` reads their content
    // files, and a snapshot without them assembles a bundle whose shared blueprints are silently
    // empty - a game that behaves differently with nothing on screen to say so.
    const wanted = blueprintAssetContentPaths(blueprintShard);
    let skippedFiles = 0;
    let skippedBytes = 0;
    for (const entry of media) {
        if (!wanted.has(entry.path)) {
            skippedFiles += 1;
            skippedBytes += entry.size;
            continue;
        }
        const written = await writeEntry(directory, entry, await options.source.read(entry));
        files += 1;
        bytes += written.length;
    }

    const durationMs = Date.now() - started;
    options.onProgress?.(
        `materialised revision ${options.revision.slice(0, 12)} in ${durationMs} ms`
        + ` (${files} file(s), ${formatBytes(bytes)}; ${skippedFiles} media file(s) left in place,`
        + ` ${formatBytes(skippedBytes)})`,
    );
    return { directory, files, bytes, skippedFiles, skippedBytes, durationMs };
}

/**
 * Split what a revision holds into what the snapshot writes and what it may skip.
 *
 * Exported for the test that holds this against {@link isVersioned}: a repository should never
 * contain an excluded path, but a revision is untrusted input from a file the author's other tools
 * can also write, and one `..` segment in it would put this function's output outside the snapshot.
 */
export function partitionSnapshotEntries(entries: readonly RevisionFileEntry[]): {
    documents: RevisionFileEntry[];
    media: RevisionFileEntry[];
} {
    const documents: RevisionFileEntry[] = [];
    const media: RevisionFileEntry[] = [];
    for (const entry of entries) {
        if (!isVersioned(entry.path)) continue;
        (entry.path.startsWith(MEDIA_PREFIX) ? media : documents).push(entry);
    }
    return { documents, media };
}

/**
 * The `assets/content/**` paths named by the blueprint metadata shard.
 *
 * Built with the same `splitAssetStorageId` the compile path resolves with, rather than a second
 * spelling of the two-level fan-out - the two disagreeing would mean a blueprint present on disk and
 * absent from the bundle.
 */
export function blueprintAssetContentPaths(shard: Buffer | undefined): Set<string> {
    if (!shard) return new Set();
    let record: unknown;
    try {
        record = JSON.parse(shard.toString("utf-8"));
    } catch {
        // The compile path treats a broken shard as "no shared blueprints" too, so a snapshot that
        // skips their content matches what the bundle would hold anyway.
        return new Set();
    }
    if (typeof record !== "object" || record === null) return new Set();
    const paths = new Set<string>();
    for (const assetId of Object.keys(record)) {
        try {
            const [a, b, rest] = splitAssetStorageId(assetId);
            paths.add(`${MEDIA_PREFIX}${a}/${b}/${rest}`);
        } catch {
            // An id that is not a storage id has no content file; the compile path skips it as well.
        }
    }
    return paths;
}

/**
 * How long to keep trying to remove a snapshot.
 *
 * Same shape and the same numbers as `repository.ts`'s rollback of a half-created `.lore/`, and for
 * the same measured reason: on Windows a recursive remove of a tree that was just written fails with
 * EPERM while anything still holds a handle in it - an indexer, a virus scanner, or simply another
 * remove of the same tree.
 */
const REMOVE_ATTEMPTS = 20;
const REMOVE_RETRY_MS = 100;

/**
 * Remove one project's snapshots, and answer whether they are actually gone.
 *
 * Never throws: a snapshot that outlives its session is disk to reclaim, not a reason to fail whatever
 * the caller was doing. But it does not lie either, and that distinction is the whole point - the
 * earlier version swallowed the error and returned void, so a removal that did nothing was
 * indistinguishable from one that worked. Combined with "rebuilt on every launch", a silent failure is
 * a full copy of a revision's documents left in the author's project with nobody to notice.
 *
 * MEASURED: two concurrent `fs.rm` of the same tree fail on Windows 20 times out of 20, one of the two
 * with EPERM. So the retry is not paranoia, and the caller must ALSO not start a second removal
 * concurrently - see `DevModeManager.discardSnapshot`, which single-flights it.
 */
export async function removeRevisionSnapshots(projectPath: string): Promise<boolean> {
    const root = revisionSnapshotsRoot(projectPath);
    for (let attempt = 0; attempt < REMOVE_ATTEMPTS; attempt++) {
        try {
            await fs.rm(root, { recursive: true, force: true });
            return true;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, REMOVE_RETRY_MS));
        }
    }
    // One last look rather than reporting the last error: another remover finishing the job counts as
    // gone, and that is what the caller is asking about.
    return !fsSync.existsSync(root);
}

/**
 * Where one entry lands inside the snapshot, or a throw if it would land outside.
 *
 * Belt to `isVersioned`'s braces. That predicate already rejects a `..` segment, but this is the
 * line that would let a crafted tree write anywhere on the disk, so it does not depend on another
 * function having been called first - and therefore is exported and tested on its own, since
 * through {@link materializeRevisionSnapshot} the predicate always runs first and nothing crafted
 * ever reaches here.
 *
 * Worth being precise about what escapes, because the obvious candidate does not: an ABSOLUTE entry
 * path cannot get out, on either platform. `path.join` only concatenates, so a leading separator is
 * neutralised and `/absolute.json` becomes a file directly inside the snapshot. A `..` segment is
 * the only escape, which is why that is what this rejects.
 */
export function resolveSnapshotEntryTarget(directory: string, entryPath: string): string {
    const resolved = path.resolve(path.join(directory, ...entryPath.split("/")));
    if (resolved !== directory && !resolved.startsWith(directory + path.sep)) {
        throw new Error(`Revision entry escapes the snapshot directory: ${entryPath}`);
    }
    return resolved;
}

async function writeEntry(directory: string, entry: RevisionFileEntry, bytes: Buffer): Promise<Buffer> {
    const resolved = resolveSnapshotEntryTarget(directory, entry.path);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    // Plain write, not `Fs.writeRaw`: that one is the atomic writer (temp sibling, rename, directory
    // fsync), which for a few hundred files costs more than the read and litters the snapshot with
    // `*.nltmp` siblings if it is interrupted. Nothing reads this directory until the whole
    // materialisation has resolved, and a failure refuses the launch rather than leaving a half-built
    // snapshot in use.
    await fs.writeFile(resolved, bytes);
    return bytes;
}

