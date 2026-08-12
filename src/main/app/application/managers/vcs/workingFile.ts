import fs from "fs/promises";
import path from "path";
import { isVersioned } from "@shared/vcs/workingSet";
import { COMPARISON_PREVIEW_BYTE_CEILING } from "./diff/documentDiff";

/**
 * The bytes of one file **as the working tree holds it now**.
 *
 * The other half of `VcsManager.readBlob`, which answers for a revision. A comparison has two
 * sides and until now only one of them could be turned back into bytes: the change list could say
 * a sprite is 40 KB larger and nothing could put the two sprites next to each other. Nothing else
 * on the `fs` surface reads bytes either - it has `stat`, `list`, `details` and `directorySize` -
 * and widening one of those to "read any file" would put a general file reader in front of the
 * renderer to serve one panel.
 *
 * So this is deliberately narrow: one repository-relative path, under version control, small
 * enough to draw. The three guards below are the whole module, and each of them REFUSES rather
 * than degrades, on `revisionRestore.ts`'s reasoning: a read that quietly answered with something
 * other than what was asked for would be drawn as the author's file.
 *
 *  - **A path is untrusted input.** It arrives from a renderer, over IPC, having originally come
 *    out of a repository the author's other tools can write. One `..` segment or one drive letter
 *    is a read outside the project.
 *  - **Only the working set.** {@link isVersioned} is the same predicate the scan, the ignore file
 *    and the restore run on. A comparison can only ever name a path inside it, so a request for
 *    `.nlstudio/` or `node_modules` is not a file to be helpful about.
 *  - **A ceiling, checked before the read.** On disk the size is known first, so refusing costs
 *    nothing and no half a file is ever handed over.
 */

/** Why a read was refused. Each one is a different fact and the surface says a different thing. */
export type WorkingFileRefusal =
    /** The path would leave the project directory. */
    | "escapes"
    /** A real path, outside what version control covers. */
    | "excluded"
    /** A versioned file, past {@link COMPARISON_PREVIEW_BYTE_CEILING}. */
    | "tooLarge";

/**
 * A refusal, with which of the three it was.
 *
 * One class rather than three, because a caller either handles the reason or does not: the
 * renderer draws a sentence for `tooLarge` and treats the other two as faults, and a discriminant
 * says that in one place instead of an `instanceof` ladder.
 */
export class WorkingFileRefusedError extends Error {
    constructor(readonly refusal: WorkingFileRefusal, readonly offending: string, detail?: string) {
        super(`Refused to read ${offending}: ${detail ?? refusal}`);
        this.name = "WorkingFileRefusedError";
    }
}

export interface WorkingFileReadOptions {
    /** Defaults to {@link COMPARISON_PREVIEW_BYTE_CEILING}. */
    readonly limit?: number;
}

/**
 * One versioned file's bytes, or a {@link WorkingFileRefusedError}.
 *
 * @param projectPath the project directory, which is also the repository root.
 * @param relativePath repository-relative, either separator. Untrusted.
 */
export async function readWorkingSetFile(
    projectPath: string,
    relativePath: string,
    options: WorkingFileReadOptions = {},
): Promise<Buffer> {
    const limit = options.limit ?? COMPARISON_PREVIEW_BYTE_CEILING;
    // Before the working-set test, not after, and for the reason `planRevisionRestore` spells out:
    // `isVersioned` answers false for a `..` segment and TRUE for `C:/Windows/System32/x`, so
    // asking it first would turn the one input that has to be refused into an ordinary exclusion.
    const relative = assertRepositoryRelative(relativePath);
    if (!isVersioned(relative)) {
        throw new WorkingFileRefusedError("excluded", relativePath, "it is not under version control");
    }

    const root = path.resolve(projectPath);
    const absolute = resolveInside(root, relative);

    const stats = await fs.stat(absolute);
    if (stats.size > limit) {
        throw new WorkingFileRefusedError(
            "tooLarge",
            relativePath,
            `it is ${stats.size} bytes, over the ${limit} byte ceiling`,
        );
    }

    const bytes = await fs.readFile(absolute);
    if (bytes.length > limit) {
        // The file grew between the two calls. Cheap to check and the only way the ceiling can be
        // passed anyway, and a refusal here still beats handing over what was asked to be refused.
        throw new WorkingFileRefusedError(
            "tooLarge",
            relativePath,
            `it grew to ${bytes.length} bytes while it was being read`,
        );
    }
    return bytes;
}

/**
 * One repository-relative path, or a refusal. Pure string work.
 *
 * The same three tests `revisionRestore.ts` applies, and deliberately stricter than
 * {@link isVersioned}: that predicate answers "should this be versioned", which was never a
 * containment test.
 */
function assertRepositoryRelative(candidate: string): string {
    const normalized = candidate.replace(/\\/g, "/").replace(/^\.\//, "");
    if (normalized.length === 0) {
        throw new WorkingFileRefusedError("escapes", candidate, "it names nothing");
    }
    // A drive-qualified path, a POSIX absolute path and a UNC share all start one of three ways.
    if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith("/")) {
        throw new WorkingFileRefusedError("escapes", candidate, "it is absolute");
    }
    if (normalized.split("/").some((segment) => segment === "..")) {
        throw new WorkingFileRefusedError("escapes", candidate, "it leaves the project directory");
    }
    return normalized;
}

/**
 * The absolute path one relative entry names, checked against the project root.
 *
 * Not redundant with the string test above: this is the line that hands a path to the filesystem,
 * so it does not depend on another function having been called first.
 */
function resolveInside(root: string, relative: string): string {
    const resolved = path.resolve(path.join(root, ...relative.split("/")));
    if (resolved === root || !resolved.startsWith(root + path.sep)) {
        throw new WorkingFileRefusedError("escapes", relative, "it resolves outside the project directory");
    }
    return resolved;
}
