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
    | { kind: "manual" }
    /**
     * A merge is open and left files it could not settle.
     *
     * **Not entered by anything the author pressed** - it is armed while the workspace is starting,
     * before a service has parsed a document, because the tree underneath is not one version of the
     * project: some files are the merge's automatic result and the conflicted ones are unparseable
     * (docs §4.23). What the editors show is the author's own side, read out of the merge's copies
     * (`@/lib/app/mergeConflictReads`), so an edit saved here would write pre-merge content over the
     * merge's own result - which is precisely what this latch refuses.
     *
     * The way out is finishing or abandoning the merge, not `thaw`, and the rail's strip offers
     * that instead of its usual escape.
     */
    | { kind: "merge" }
    /**
     * The window is a recovery shell.
     *
     * Armed before the first service initializes and never lifted - `thaw` is not offered, because
     * leaving recovery mode means reloading the window, not unlatching. Recovery mode exists to look
     * at a project that is already damaged, and the one thing it must never do is make the damage
     * worse or destroy the evidence: without this latch, merely *opening* the project resets a
     * corrupt asset shard to `{}` (see `AssetsMetadataManager`), and the file the author came to
     * diagnose is gone before they have read the error about it.
     *
     * The lore actions the recovery panel offers are unaffected: those run in the main process,
     * which is not behind this gate.
     */
    | { kind: "recovery" };

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

/**
 * The second reason a project-data write is refused: the workspace is re-reading the working tree,
 * so every in-memory document is either being replaced or has already been thrown away.
 *
 * Deliberately NOT the same latch as {@link frozen}, and deliberately invisible:
 *
 *  - {@link getProjectWriteFreeze} and {@link observeProjectWriteFreeze} do not see it, because a
 *    reload is not a state the author is in - it happens *while leaving* one, and a freeze notice
 *    that blinked back on as the workspace unfroze would read as the unfreeze having failed.
 *  - a refusal here is not announced on {@link observeRefusedWrites} either. That channel means "your
 *    work is not being saved", and during a reload nothing of the author's is at stake: the only
 *    writes it can catch come from a load path re-materialising what it just read off the disk.
 *    Those get a console line, because a write attempt during a reload is a defect worth finding,
 *    not a toast.
 *
 * Held rather than latched: the reload is async, several services deep, and the window that has to
 * be closed is the one between "the freeze is gone" and "memory has been replaced". A pending
 * auto-save firing inside it would write the very bytes the reload exists to discard.
 */
let reloadHold: { projectPath: string; depth: number } | null = null;

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

/**
 * Refuse project-data writes until the returned function is called, because the working tree is
 * being re-read into the editors. See {@link reloadHold}.
 *
 * Returns the release rather than exposing an `end` of its own so the hold cannot outlive its
 * caller's `finally`. Re-entrant: nested holds (a restore arriving while a thaw is still reloading)
 * count, and only the last release lifts it.
 */
export function holdProjectWritesForReload(projectPath: string): () => void {
    if (reloadHold && reloadHold.projectPath === projectPath) {
        reloadHold.depth += 1;
    } else {
        // A window is one project (see the multi-project window model), so a hold naming a different
        // project is a stale one from a project that has already closed.
        reloadHold = { projectPath, depth: 1 };
    }
    let released = false;
    return () => {
        if (released || !reloadHold) {
            return;
        }
        released = true;
        reloadHold.depth -= 1;
        if (reloadHold.depth <= 0) {
            reloadHold = null;
        }
    };
}

/** Whether a working-tree re-read is holding writes off right now. Exported for tests. */
export function isProjectWriteReloadHeld(): boolean {
    return reloadHold !== null;
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

/**
 * The reload half of the gate. True when one of `paths` is project data that may not be written
 * right now because the working tree is being re-read; false when the write may proceed.
 *
 * Separate from {@link refuseFrozenWrite} rather than folded into it because the two answers are
 * reported differently - see {@link reloadHold} - and because a caller that consults only one of
 * them should read as having made that choice. The write boundary consults both.
 */
export function refuseReloadingWrite(...paths: (string | null | undefined)[]): boolean {
    const hold = reloadHold;
    if (!hold) {
        return false;
    }
    for (const path of paths) {
        if (typeof path === "string" && isFrozenProjectData(hold.projectPath, path)) {
            // Not a toast: nothing of the author's is at stake, but a load path that writes during a
            // reload is worth finding, and this is the only place that can name the file.
            console.warn("[writeFreeze] refused a write while the working tree was being re-read", path);
            return true;
        }
    }
    return false;
}

/** Whether one absolute path is project data belonging to `projectPath`. Exported for tests. */
export function isFrozenProjectData(projectPath: string, absolutePath: string): boolean {
    return versionedProjectRelativePath(projectPath, absolutePath) !== null;
}

/**
 * Where `absolutePath` lives inside `projectPath` if the repository stores it, else null.
 *
 * The same predicate as {@link isFrozenProjectData}, keeping the relative path it had to
 * compute anyway. The read side needs it: a document source answers project-relative
 * paths, and re-deriving one there would be a second implementation of the project-root
 * comparison this module owns - including the Windows case-folding rule that a second
 * copy would get subtly wrong.
 */
export function versionedProjectRelativePath(projectPath: string, absolutePath: string): string | null {
    const relative = repositoryRelative(projectPath, absolutePath);
    return relative !== null && isVersioned(relative) ? relative : null;
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
