import path from "path";
import type { WorkspaceFreezeKind } from "@shared/types/ipcEvents";
import type { RevisionId } from "@shared/types/vcs";

/**
 * Whether a project's workspace is frozen, as its renderer last reported it.
 *
 * **This is not a second source of truth for the write gate.** Freeze lives in the renderer, at the
 * write boundary (`@/lib/app/writeFreeze`), and that stays the only thing deciding whether project
 * data may be written - the whole correctness argument for putting it there is that no component has
 * to remember anything. This record exists for the operations **main starts on its own**: the
 * production build and the Preview runtime. Both are reached by IPC, so the disabled controls in the
 * top bar are affordance only - a keybinding, a plugin, a stale renderer or a second window can all
 * still ask, and main is the only place that can answer no.
 *
 * The refusal is a **consistency** guard, not a data-safety one. The working tree still holds the
 * author's current content while frozen (browsing history does not touch it), so a build that
 * slipped through would package the project correctly. What is
 * wrong is that the author is reading a past revision and would have no way to know that is not what
 * they just built or ran.
 *
 * Keyed per project, like every other per-project state in main (`GameBuildManager`'s sessions,
 * `PreviewManager`'s, `VcsManager`'s): Studio is one project per window, and a single flag would let
 * the window browsing history refuse the build in the window next to it.
 */

/** The operations main refuses while frozen, named as the author would name them. */
export type WorkspaceFrozenOperation = "production build" | "preview" | "patch export";

/**
 * What a frozen workspace reported: why, and - when the why is a revision - which one.
 *
 * The revision is here rather than in a table of its own because the two facts have exactly one
 * lifetime between them. A second map keyed the same way would be a second thing to clear when the
 * window closes, and the failure of forgetting it is a Dev Mode launch compiling a revision the
 * author left ten minutes ago.
 *
 * `revision` is optional even for a `"revision"` freeze, because the report crosses IPC from a
 * renderer that may be older than this record. Every reader must decide what to do about its absence,
 * and for Dev Mode the answer is to refuse (see {@link WorkspaceFrozenState}'s consumer in
 * `devMode/revisionLaunchSource.ts`) - never to fall back to the working tree.
 */
export interface WorkspaceFrozenState {
    kind: WorkspaceFreezeKind;
    revision?: RevisionId;
}

/**
 * Only frozen projects are present. Absence is the default and the default is "may run": a record
 * that had to be told something before it would allow anything would refuse the build in every
 * window that never froze - which is nearly all of them.
 */
const frozenProjects = new Map<string, WorkspaceFrozenState>();

/**
 * The same key the two managers use for their own per-project state (`path.resolve`, which also
 * drops a trailing separator). They have to agree: a key that resolved differently would make the
 * guard silently fail open, which is the one failure mode nobody would notice.
 */
function projectKey(projectPath: string): string {
    return path.resolve(projectPath);
}

/**
 * Record what a workspace reported, or forget the project when `reason` is null.
 *
 * Both directions are reported, and so is the current state at startup. That last one is not
 * belt-and-braces: the renderer's latch is module-level and deliberately never persisted, so a
 * window that reloads mid-freeze comes back writable - while this record would still say "frozen"
 * and refuse that project's builds for the rest of the session, with nothing anywhere to explain
 * why.
 */
export function reportWorkspaceFreeze(
    projectPath: string,
    reason: WorkspaceFreezeKind | null,
    revision?: RevisionId,
): void {
    if (reason === null) {
        frozenProjects.delete(projectKey(projectPath));
        return;
    }
    // Only a revision freeze keeps one. A manual freeze that inherited the id of the last revision
    // browsed would make Dev Mode run history while the author believes they are on their own files -
    // the working tree IS what is on disk during a manual freeze, so running it is the correct answer.
    frozenProjects.set(projectKey(projectPath), {
        kind: reason,
        ...(reason === "revision" && revision ? { revision } : {}),
    });
}

/** Why this project's workspace is frozen, or null when it is not - which is the default. */
export function getWorkspaceFreeze(projectPath: string): WorkspaceFreezeKind | null {
    return frozenProjects.get(projectKey(projectPath))?.kind ?? null;
}

/**
 * The whole record, for the one caller that needs more than the reason: Dev Mode, which compiles the
 * revision the author is looking at instead of refusing.
 *
 * Separate from {@link getWorkspaceFreeze} so the two refusals that only need the reason keep reading
 * a `WorkspaceFreezeKind` and cannot accidentally start depending on a field that is allowed to be
 * missing.
 */
export function getWorkspaceFreezeState(projectPath: string): WorkspaceFrozenState | null {
    return frozenProjects.get(projectKey(projectPath)) ?? null;
}

/**
 * Forget a project's freeze because the window that could report it is gone.
 *
 * Nothing in main can observe a freeze or clear one on its own, so without this a project reopened
 * later would inherit a freeze nobody could see and its builds would refuse forever.
 */
export function forgetWorkspaceFreeze(projectPath: string): void {
    frozenProjects.delete(projectKey(projectPath));
}

/**
 * What the author is told. Written for a person, because it is the only explanation they get: the
 * refusal reaches them through the workspace console and the build dialog, not a log file.
 */
export function workspaceFrozenMessage(reason: WorkspaceFreezeKind, operation: WorkspaceFrozenOperation): string {
    const remedy = reason === "revision"
        ? "Leave the revision you are looking at, or unfreeze the workspace, and try again."
        // A merge has no "unfreeze": the working tree holds two sides at once, and what a build
        // produced from it is something nobody wrote. Finishing the merge is the only way out, and
        // naming it is the difference between a refusal and a dead end.
        : reason === "merge"
            ? "Finish the merge in the version panel - choose which side to keep for each file - and try again."
            // Recovery mode has no "unfreeze" either, and refusing here is not merely consistency:
            // the shell starts almost none of the services a build reads from, so what it produced
            // would be a game missing most of the project rather than a build of it.
            : reason === "recovery"
                ? "Leave recovery mode - this window reopens as a normal workspace - and try again."
                : "Unfreeze the workspace and try again.";
    return `The ${operation} is unavailable while this workspace is frozen: what it produced would `
        + `not be what you are looking at. ${remedy}`;
}
