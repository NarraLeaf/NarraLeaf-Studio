import { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { recentProjectDisplayName } from "@shared/utils/recentProject";

/**
 * What `--project` resolved to.
 *
 * `source` is only for the log line, and it earns its place there: "opened the project you named"
 * and "opened the one recent project whose name contains what you typed" are worth telling apart
 * when the window that comes up is not the one that was expected.
 */
export type StartupProjectResolution =
    | { ok: true; projectPath: string; source: "path" | "recent" }
    | { ok: false; reason: string };

export interface StartupProjectLookup {
    /**
     * The absolute path of `candidate` if it is a directory, otherwise null. Injected so the
     * decision below can be tested without a file system, and so the caller owns how a relative
     * path is resolved (against the process's working directory, which only it knows).
     */
    resolveDirectory(candidate: string): string | null;
    /** The recently-opened history, names already repaired (i.e. `RecentlyOpened.list()`). */
    recentProjects(): readonly RecentlyOpenedProject[];
}

/** Case-insensitive, whitespace-insensitive form used for every name comparison below. */
function foldName(value: string): string {
    return value.trim().toLowerCase();
}

function describe(projects: readonly RecentlyOpenedProject[]): string {
    if (projects.length === 0) {
        return "the recent project list is empty";
    }
    return `known projects: ${projects.map(project => recentProjectDisplayName(project)).join(", ")}`;
}

/**
 * Turn what `--project` was given into a project path to open.
 *
 * A path is tried first and wins outright, because it is the unambiguous thing to have asked for.
 * Everything else is matched against the recently-opened list by name - exactly first, then as a
 * substring - so a scripted launch can say `--project demo3` without first reading the list and
 * without carrying a Windows path (backslashes, drive letters and CJK segments) through a shell.
 *
 * Ambiguity is an error rather than a guess: two projects called "demo" are exactly the case where
 * opening the wrong one wastes a whole run before anyone notices. Every failure names what was
 * available, since the caller is usually a script that cannot go and look.
 *
 * Nothing here touches the disk beyond `resolveDirectory`, and nothing here opens anything - a
 * resolution is a *claim about which project was meant*, and whether that project can actually be
 * loaded is the workspace's answer to give.
 */
export function resolveStartupProject(selector: string, lookup: StartupProjectLookup): StartupProjectResolution {
    const wanted = selector.trim();
    if (wanted === "") {
        return { ok: false, reason: "--project was given an empty value" };
    }

    const directory = lookup.resolveDirectory(wanted);
    if (directory !== null) {
        return { ok: true, projectPath: directory, source: "path" };
    }

    const projects = lookup.recentProjects();
    const folded = foldName(wanted);

    const exact = projects.filter(project => foldName(recentProjectDisplayName(project)) === folded);
    if (exact.length === 1) {
        return { ok: true, projectPath: exact[0].path, source: "recent" };
    }
    if (exact.length > 1) {
        return {
            ok: false,
            reason: `--project "${wanted}" matches ${exact.length} recent projects `
                + `(${exact.map(project => project.path).join(", ")}). Pass the path instead.`,
        };
    }

    const partial = projects.filter(project => foldName(recentProjectDisplayName(project)).includes(folded));
    if (partial.length === 1) {
        return { ok: true, projectPath: partial[0].path, source: "recent" };
    }
    if (partial.length > 1) {
        return {
            ok: false,
            reason: `--project "${wanted}" matches ${partial.length} recent projects `
                + `(${partial.map(project => project.path).join(", ")}). Pass the path instead.`,
        };
    }

    return {
        ok: false,
        reason: `--project "${wanted}" is not a directory and matches no recent project (${describe(projects)})`,
    };
}
