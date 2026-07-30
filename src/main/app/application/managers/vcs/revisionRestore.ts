import fs from "fs/promises";
import path from "path";
import { isVersioned } from "@shared/vcs/workingSet";
import { collectWorkingSet } from "./workingSet";
// Type-only, and it has to stay that way: `revisionReader` reaches the native library at module
// scope, so a value import would put the whole Lore binding into the graph of a module whose policy
// is meant to be testable without a repository. Same rule as `revisionSnapshot.ts`.
import type { RevisionFileEntry } from "./revisionReader";

/**
 * Putting the author's working tree back to what a past revision held.
 *
 * This is the FIRST thing in the whole version-control feature that overwrites the author's files.
 * Everything before it - browsing history, running a past revision in Dev Mode - is arranged so that
 * the worst outcome is a wrong-looking screen. Here the worst outcome is lost work, so the module is
 * shaped around the three ways that happens.
 *
 * **The deletions are the dangerous half.** A file that exists now and did not exist at the target
 * revision has to go, or what the author gets back is not that version - it is that version plus
 * everything they added since, silently. But "delete a file in the project directory" is also the one
 * operation here that cannot be undone by writing bytes, so the rule is narrow and absolute: the ONLY
 * thing that may be removed is a path {@link isVersioned} accepts, enumerated by
 * {@link collectWorkingSet}. `.nlstudio/`, `editor/cache`, `dist`, `.lore/` and `node_modules` are
 * outside the working set, which means the restore has nothing to say about them in either direction.
 *
 * **Nothing removes a directory tree.** Files are unlinked one at a time; there is no
 * `rm(dir, { recursive: true })` anywhere in this module, and there must not be. An empty directory
 * left behind is litter, and litter is recoverable in a way a wrongly-recursed delete is not. The
 * pruning pass afterwards uses `rmdir`, which REFUSES a directory that still has anything in it - that
 * refusal is the safety property, not an inconvenience to work around.
 *
 * **A revision is untrusted input.** The repository is a directory the author's other tools can write,
 * so an entry's path is not a Studio-controlled string, and one `..` segment would put a write - or a
 * DELETE - outside the project. The same boundary check therefore runs on both sides, and it REJECTS
 * rather than skips: a restore that quietly dropped an entry it did not like would produce a tree that
 * is neither the revision nor the working tree, and nothing anywhere would say so.
 *
 * What is deliberately NOT skipped here, in contrast to {@link import("./revisionSnapshot")}: the
 * author's asset bytes under `assets/content/**`. A Dev Mode snapshot may leave them in the repository
 * because the compile path never opens one, so skipping them costs nothing and saves the project's
 * whole art budget per launch. A restore has no such licence - a project whose documents went back to
 * last week while the sprites stayed current is not the version the author asked for, and nothing on
 * screen would tell them.
 */

/**
 * A path in the revision that would put a write or a delete outside the project directory.
 *
 * Its own error, and thrown rather than filtered, because the two possible responses are opposite: a
 * restore that refuses is a restore the author can retry, and a restore that skipped the entry would
 * hand them a tree that matches neither version with no indication anything was left out.
 */
export class RestorePathEscapesProjectError extends Error {
    constructor(readonly offending: string) {
        super(`Revision entry escapes the project directory: ${offending}`);
        this.name = "RestorePathEscapesProjectError";
    }
}

export interface RevisionRestorePlan {
    /** Entries to write, revision-relative. Both "absent on disk" and "present but possibly different". */
    write: RevisionFileEntry[];
    /** Repository-relative paths to remove: versioned, on disk now, absent from the target revision. */
    remove: string[];
    /** Revision entries the working set excludes, so neither side touches them. Reported, not acted on. */
    ignored: number;
}

/**
 * Decide what the restore writes and what it removes. Pure: no filesystem, no backend.
 *
 * Both inputs are repository-relative. The four cases and why each is what it is:
 *
 *  - **in the revision, not on disk** -> write. The file was deleted after the target revision.
 *  - **in both** -> write, unconditionally. No mtime comparison and no hash shortcut: the bytes on
 *    disk are whatever the author has now, and "same size, same time" is exactly how a restore
 *    produces a tree that looks right and is not. Rewriting a file with the bytes it already had is
 *    measured NOT to register as a change (see `repository.integration.test.ts`), so the unconditional
 *    write costs a commit nothing.
 *  - **on disk, not in the revision** -> remove. The file was added after the target revision, and
 *    leaving it is what turns a restore into a merge nobody asked for.
 *  - **outside the working set** -> neither. On the revision side those entries are counted as
 *    {@link RevisionRestorePlan.ignored}; on the disk side they never reach here, because
 *    {@link collectWorkingSet} does not enumerate them.
 */
export function planRevisionRestore(input: {
    revision: readonly RevisionFileEntry[];
    /** Versioned files currently on disk, repository-relative. From {@link readWorkingSetPaths}. */
    working: readonly string[];
}): RevisionRestorePlan {
    const write: RevisionFileEntry[] = [];
    const wanted = new Set<string>();
    let ignored = 0;

    for (const entry of input.revision) {
        // Before the working-set test, not after: `isVersioned` answers false for a `..` segment, so
        // asking it first would turn the one input that has to be REFUSED into one that is silently
        // dropped - and an absolute path it answers TRUE for, which is why the check is here at all.
        const relative = assertRepositoryRelative(entry.path);
        if (!isVersioned(relative)) {
            ignored += 1;
            continue;
        }
        wanted.add(relative);
        write.push({ ...entry, path: relative });
    }

    const remove: string[] = [];
    for (const candidate of input.working) {
        const relative = assertRepositoryRelative(candidate);
        // Defence in depth rather than a second filter: the walk already applies this predicate, and a
        // disagreement between the two would mean the restore deleting something the repository never
        // had a chance to record.
        if (!isVersioned(relative) || wanted.has(relative)) continue;
        remove.push(relative);
    }

    return { write, remove, ignored };
}

/**
 * Every versioned file currently on disk, repository-relative with forward slashes.
 *
 * The walk answers ABSOLUTE paths (Lore resolves a relative one against the process working
 * directory, so absolute is the only safe shape to hand the backend); the plan reasons in
 * repository-relative ones, because that is the shape a revision tree speaks. The conversion lives
 * here so the two halves cannot drift.
 */
export async function readWorkingSetPaths(projectPath: string): Promise<string[]> {
    const root = path.resolve(projectPath);
    const absolute = await collectWorkingSet(root);
    return absolute.map((file) => path.relative(root, file).replace(/\\/g, "/"));
}

export interface RevisionRestoreSource {
    /** The bytes of one planned entry. */
    read(entry: RevisionFileEntry): Promise<Buffer>;
}

export interface RevisionRestoreResult {
    filesWritten: number;
    bytesWritten: number;
    filesRemoved: number;
    durationMs: number;
}

/**
 * Carry out a plan against the working tree.
 *
 * **Writes first, deletions last.** They cannot overlap - a path in `remove` is by construction absent
 * from `write` - so the order is free to be chosen for what an interruption leaves behind, and a tree
 * with too much in it is recoverable by the author's own eyes while a tree with holes in it is not.
 *
 * Plain writes rather than Studio's atomic writer. The restore as a whole is not atomic (it is
 * hundreds of files), so per-file atomicity buys nothing the checkpoint taken beforehand does not
 * already provide, and it would double the write cost over a project's entire document set.
 */
export async function applyRevisionRestore(options: {
    projectPath: string;
    plan: RevisionRestorePlan;
    source: RevisionRestoreSource;
    /** Progress, for a restore that would otherwise look hung on a large project. */
    onProgress?: (message: string) => void;
}): Promise<RevisionRestoreResult> {
    const started = Date.now();
    // Resolved once, because it is the boundary every write and every delete below is checked against.
    const root = path.resolve(options.projectPath);
    options.onProgress?.(
        `restoring ${options.plan.write.length} file(s), removing ${options.plan.remove.length}`,
    );

    let filesWritten = 0;
    let bytesWritten = 0;
    for (const entry of options.plan.write) {
        const target = resolveInside(root, entry.path);
        const bytes = await options.source.read(entry);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes);
        filesWritten += 1;
        bytesWritten += bytes.length;
    }

    let filesRemoved = 0;
    const emptied = new Set<string>();
    for (const relative of options.plan.remove) {
        const target = resolveInside(root, relative);
        // `recursive: false` spelled out rather than left to the default: this is the one call in the
        // feature that deletes the author's files, and the difference between it and the recursive
        // form is the difference between one stale document and a directory tree. `force` covers a
        // file another process removed between the walk and here, which is not a failure.
        await fs.rm(target, { force: true, recursive: false });
        emptied.add(path.dirname(target));
        filesRemoved += 1;
    }
    await pruneEmptyDirectories(root, emptied);

    const durationMs = Date.now() - started;
    options.onProgress?.(
        `restored ${filesWritten} file(s), removed ${filesRemoved}, in ${durationMs} ms`,
    );
    return { filesWritten, bytesWritten, filesRemoved, durationMs };
}

/**
 * Remove directories the deletions left with nothing in them.
 *
 * `rmdir` and never `rm(..., { recursive: true })`: it fails with ENOTEMPTY on a directory that still
 * holds anything, and that refusal is the entire safety argument - a directory holding a file the
 * restore deliberately did not touch (a cache, a nested `.nlstudio/`) survives by definition rather
 * than by this function having remembered to check.
 *
 * Deepest first, so a chain of nested empties collapses in one pass. Every failure is ignored: an
 * empty directory is cosmetic, and a restore that already put the right bytes on disk must not be
 * reported as failed because a folder outlived its contents.
 */
async function pruneEmptyDirectories(root: string, directories: ReadonlySet<string>): Promise<void> {
    const candidates = new Set<string>();
    for (const directory of directories) {
        // Every ancestor, because removing the last file in `a/b/c` can empty `a/b` and `a` too.
        for (let current = directory; current.startsWith(root + path.sep); current = path.dirname(current)) {
            candidates.add(current);
        }
    }
    const deepestFirst = [...candidates].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
    for (const directory of deepestFirst) {
        await fs.rmdir(directory).catch(() => undefined);
    }
}

/**
 * One repository-relative path, or a refusal.
 *
 * Pure string work, so the plan can be tested without a filesystem, and deliberately stricter than
 * {@link isVersioned}: that predicate answers "should this be versioned", which is FALSE for `..` and
 * TRUE for `C:/Windows/System32/x` - it was never a containment test and reading it as one is how an
 * absolute path in a crafted tree would reach the writer.
 */
function assertRepositoryRelative(candidate: string): string {
    const normalized = candidate.replace(/\\/g, "/").replace(/^\.\//, "");
    if (normalized.length === 0) {
        throw new RestorePathEscapesProjectError(candidate);
    }
    // A drive-qualified path, a POSIX absolute path, and a UNC share all start the same three ways.
    if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith("/")) {
        throw new RestorePathEscapesProjectError(candidate);
    }
    if (normalized.split("/").some((segment) => segment === "..")) {
        throw new RestorePathEscapesProjectError(candidate);
    }
    return normalized;
}

/**
 * The absolute path one relative entry names, checked against the project root.
 *
 * Belt to {@link assertRepositoryRelative}'s braces, and not redundant: this is the line that actually
 * hands a path to `writeFile` and to `rm`, so it does not depend on another function having been
 * called first. `path.join` contains an absolute segment rather than rejecting it, which is precisely
 * the case a resolve-and-compare catches and a string test can miss.
 */
function resolveInside(root: string, relative: string): string {
    const resolved = path.resolve(path.join(root, ...relative.split("/")));
    if (resolved === root || !resolved.startsWith(root + path.sep)) {
        throw new RestorePathEscapesProjectError(relative);
    }
    return resolved;
}
