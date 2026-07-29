import type { RevisionId } from "@shared/types/vcs";
import { isVersioned } from "@shared/vcs/workingSet";
import { sep } from "@shared/utils/path";

/**
 * The latch that stops the renderer writing project data.
 *
 * Freeze exists so the author can look at a past revision with the whole workspace inert. The
 * guarantee cannot be "every interactive component reads a read-only flag": the workspace has ~24
 * modules, four dock regions, a command palette and global keybindings, and the cost of one of them
 * forgetting is the auto-saver writing a historical document over the author's working tree. That is
 * data loss inside a feature called freeze. So the guarantee lives here, at the write boundary, and
 * a component that slipped through gets a harmless no-op plus a visible notice instead.
 *
 * **What counts as project data is not decided here.** {@link isVersioned} is the single source of
 * truth for what the repository stores, and this module only turns that predicate into a gate. So
 * `.nlstudio/` (panel layout, installed plugins, quarantine), `editor/cache/` and `dist/` keep
 * working while frozen - which is the point: the editor's own state is not the author's project, and
 * a freeze that also froze the panel layout would look like a broken application.
 *
 * **Module-level rather than per-workspace**, for the same reason `FileSystemService.observeWrites`
 * is: the write paths it guards are static, and the two places that consult it
 * (`BaseFileSystemService` and the privileged facade) are reached from renderer entry points that
 * have no workspace at all. Default off; only {@link freezeProjectWrites} arms it, and nothing here
 * is ever persisted - a frozen state that survived a restart would be a project that looks broken
 * with no way for the author to find out why.
 */

/** Why the workspace is frozen. The UI has to say, and there will be more than one cause. */
export type WorkspaceFreezeReason =
    /** The author is browsing a past revision. `label` is what to call it in the UI. */
    | { kind: "revision"; revision: RevisionId; label?: string }
    /** Entered by hand, from the command palette. */
    | { kind: "manual" };

export type WorkspaceFreeze = {
    /** The project whose data is frozen. Writes anywhere else are none of this module's business. */
    projectPath: string;
    reason: WorkspaceFreezeReason;
};

/** One write that did not happen because the workspace was frozen. */
export type RefusedWrite = {
    /** The absolute path that was going to be written. */
    path: string;
    reason: WorkspaceFreezeReason;
};

/**
 * Windows spells the same directory several ways - `D:\Proj` and `d:\proj` are one place - so
 * finding the project root in a path has to fold case there. It is deliberately the ONLY thing that
 * does.
 *
 * The relative part below keeps the author's own casing, because it is the input to
 * {@link isVersioned} and that predicate is the repository's own. Folding it too would let a project
 * folder called `Dist/` full of author content lower-case its way into the exclusion table: this gate
 * would call it derived and allow a frozen write, while the main process - which does not fold - has
 * it under version control. The two sides of one predicate disagreeing is the failure
 * `shared/vcs/workingSet.ts` calls the worst this policy can produce.
 */
const FOLD_CASE = sep === "\\";

let frozen: WorkspaceFreeze | null = null;

const freezeObservers = new Set<(freeze: WorkspaceFreeze | null) => void>();
const refusalObservers = new Set<(refusal: RefusedWrite) => void>();

/**
 * Stop project-data writes until {@link thawProjectWrites}.
 *
 * Callers are expected to have flushed whatever is owed first; see `WorkspaceFreezeService`, which
 * does. Re-freezing with a different reason is allowed and replaces the old one.
 */
export function freezeProjectWrites(freeze: WorkspaceFreeze): void {
    frozen = freeze;
    announceFreeze();
}

export function thawProjectWrites(): void {
    if (!frozen) {
        return;
    }
    frozen = null;
    announceFreeze();
}

/** The active freeze, or null when project data is writable. */
export function getProjectWriteFreeze(): WorkspaceFreeze | null {
    return frozen;
}

/** Watch freeze and thaw. Returns an unsubscribe. */
export function observeProjectWriteFreeze(observer: (freeze: WorkspaceFreeze | null) => void): () => void {
    freezeObservers.add(observer);
    return () => {
        freezeObservers.delete(observer);
    };
}

/**
 * Watch writes that were refused. Returns an unsubscribe.
 *
 * Subscribed by `SaveStatusService`, which already owns the job of telling the author that a save
 * did not happen. A refusal nobody reports is worse than the write it prevented: the author keeps
 * typing into a workspace that is quietly discarding everything.
 */
export function observeRefusedWrites(observer: (refusal: RefusedWrite) => void): () => void {
    refusalObservers.add(observer);
    return () => {
        refusalObservers.delete(observer);
    };
}

/**
 * The gate. Answers the active freeze when one of `paths` is project data that may not be written
 * right now, and announces the refusal on the way out; answers null when the write may proceed.
 *
 * Takes several paths because the verbs that move bytes have two ends and both of them are
 * mutations: `moveFile` and `rename` unlink the source as well as creating the destination, so a
 * check on the destination alone would let a frozen workspace delete a versioned file.
 */
export function refuseFrozenWrite(...paths: (string | null | undefined)[]): WorkspaceFreeze | null {
    const active = frozen;
    if (!active) {
        return null;
    }
    for (const path of paths) {
        if (typeof path === "string" && isFrozenProjectData(active.projectPath, path)) {
            announceRefusal({ path, reason: active.reason });
            return active;
        }
    }
    return null;
}

/** Whether one absolute path is project data belonging to `projectPath`. Exported for tests. */
export function isFrozenProjectData(projectPath: string, absolutePath: string): boolean {
    const relative = repositoryRelative(projectPath, absolutePath);
    return relative !== null && isVersioned(relative);
}

/**
 * The path's location inside the project, or null when it is somewhere else entirely.
 *
 * Outside the project is not this module's business - an export to the author's desktop, a keystore
 * in userData, a read of a file being imported - and answering null for it means those keep working
 * untouched while frozen.
 */
function repositoryRelative(projectPath: string, absolutePath: string): string | null {
    const root = canonical(projectPath);
    const target = canonical(absolutePath);
    // Also rejects the project directory itself, and a path that is only the root plus a
    // separator: neither leaves anything for the predicate to judge.
    if (!root || target.length <= root.length + 1 || target[root.length] !== "/") {
        return null;
    }
    if (fold(target.slice(0, root.length)) !== fold(root)) {
        return null;
    }
    return target.slice(root.length + 1);
}

/** Separators and trailing slashes only. Casing is the author's and is left alone. */
function canonical(path: string): string {
    return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
}

function fold(path: string): string {
    return FOLD_CASE ? path.toLowerCase() : path;
}

function announceFreeze(): void {
    for (const observer of freezeObservers) {
        notify(() => observer(frozen));
    }
}

function announceRefusal(refusal: RefusedWrite): void {
    for (const observer of refusalObservers) {
        notify(() => observer(refusal));
    }
}

function notify(run: () => void): void {
    try {
        run();
    } catch (error) {
        // An observer must never be able to turn a refusal into a thrown write.
        console.warn("[writeFreeze] observer threw", error);
    }
}
