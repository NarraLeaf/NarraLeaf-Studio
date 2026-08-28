import { NLPROJ_EXT } from "@shared/utils/nlproj";
import { PROJECT_PACKAGE_EXTENSION } from "@shared/utils/projectPackage";

/**
 * What a path handed to Studio from outside turns out to be.
 *
 * "From outside" is the file manager (a double-clicked `.nlproj`), the shell (`NarraLeaf-Studio
 * some/project`), and macOS's `open-file` - all of which arrive as bare paths with no way to say
 * what they are for. Studio decides that here, once, so every entry point agrees.
 */
export type LaunchOpenRequest =
    | { kind: "project"; projectPath: string }
    | { kind: "package"; packagePath: string };

export interface LaunchOpenLookup {
    /** The absolute path of `candidate` if it names an existing file, otherwise null. */
    resolveFile(candidate: string): string | null;
    /** The absolute path of `candidate` if it names an existing directory, otherwise null. */
    resolveDirectory(candidate: string): string | null;
    /** Whether `directory` holds a project config (`*.nlproj`). */
    isProjectDirectory(directory: string): boolean;
    /** The containing directory of a file path. Injected so this module needs no `path`. */
    dirname(filePath: string): string;
    /** The lowercase extension of a path, including the dot, or "" when it has none. */
    extname(filePath: string): string;
}

/**
 * Turn one path into what Studio should do with it, or null when it is not Studio's to open.
 *
 * **Only three things are recognised, and everything else is silently not an open request.** That
 * is the point rather than a limitation: this reads `process.argv`, which on a packaged launch
 * carries whatever Chromium, the shell and the operating system decided to append. A rule that
 * accepted "any path that exists" would turn a stray argument into a window; a rule that accepts
 * only a project config, a project folder and a package cannot.
 *
 *   - `Foo.nlproj` - the project *is* the folder the config sits in, which is what gets opened. The
 *     file itself is never what a workspace is pointed at.
 *   - a folder holding such a config - what `open with` on a folder, and a shell `studio .`, mean.
 *   - `Foo.nlspkg` - not a project yet. It becomes the import wizard, with the package chosen.
 *
 * A folder *without* a config is deliberately rejected rather than opened onto an error screen:
 * the request came from outside Studio, where a wrong folder is an ordinary mistake, and answering
 * it with a window that can only say "this is not a project" is worse than not answering at all.
 */
export function resolveLaunchOpenRequest(
    candidate: string,
    lookup: LaunchOpenLookup,
): LaunchOpenRequest | null {
    const wanted = candidate.trim();
    if (wanted === "") {
        return null;
    }

    const file = lookup.resolveFile(wanted);
    if (file !== null) {
        const extension = lookup.extname(file).toLowerCase();
        if (extension === NLPROJ_EXT) {
            return { kind: "project", projectPath: lookup.dirname(file) };
        }
        if (extension === PROJECT_PACKAGE_EXTENSION) {
            return { kind: "package", packagePath: file };
        }
        return null;
    }

    const directory = lookup.resolveDirectory(wanted);
    if (directory !== null && lookup.isProjectDirectory(directory)) {
        return { kind: "project", projectPath: directory };
    }

    return null;
}

/**
 * The first thing in `candidates` that Studio can open, or null.
 *
 * First rather than all: a launch is one gesture, and a file manager that passed two selected
 * projects means "open these", which is not a thing a single window can be. Opening the first is
 * the answer that is never surprising - and the rest are still one double-click away, now that the
 * second launch reaches the running instance instead of starting a rival one.
 */
export function resolveFirstLaunchOpenRequest(
    candidates: readonly string[],
    lookup: LaunchOpenLookup,
): LaunchOpenRequest | null {
    for (const candidate of candidates) {
        const request = resolveLaunchOpenRequest(candidate, lookup);
        if (request) {
            return request;
        }
    }
    return null;
}
