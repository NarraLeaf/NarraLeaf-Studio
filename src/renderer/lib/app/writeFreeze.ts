import { resolveDocumentSpecForPath } from "@shared/documents/registry";
import { localizationDocumentSpec, voiceDocumentSpec } from "@shared/documents/specs";
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
 * **A partial freeze is still that guarantee.** One reason - a live session - leaves a single
 * document writable, and the exemption is applied here, by {@link freezeAllowsWrite}, for exactly
 * the argument above: "the localization panel checks a flag before saving" is a promise made by
 * every panel that remembers to, and the ones that forget produce the same data loss with a
 * collaborator's name on it. A component that keeps writing gets the same harmless no-op and the
 * same visible notice it always did; only the set of paths that reach the notice has narrowed.
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
    | { kind: "recovery" }
    /**
     * A live session is open on this project, and only its story document may be written.
     *
     * **The one freeze that is partial.** Every other kind here is all-or-nothing over
     * {@link isVersioned}; this one carries the set of project-relative paths that are still
     * writable - the story document the session is about - and refuses the rest. The reason is that
     * only story operations travel between the people in a session, so a character created here
     * would never reach them, and the row referring to it would point at nothing on their machines.
     *
     * `session` is the room's id. Held so a stale freeze can be told from the current one: the latch
     * is module-level, and a session that ended while a slower path was still finishing must not be
     * able to arm one for a room nobody is in.
     */
    | {
        kind: "live-session";
        session: string;
        /** Project-relative, in the repository's own spelling - the input {@link isVersioned} takes. */
        writable: readonly string[];
    };

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

/**
 * The one window in which a live session may write more than the document it is about: a broadcast
 * effect is being applied right now, and the libraries that effect derives have to move with it.
 *
 * The mirror image of {@link reloadHold} - counted the same way, released the same way - except
 * that it opens a window rather than closing one, which is why everything about it is narrower.
 *
 * **Why the libraries are not simply more entries in `writable`.** A path exemption would also
 * allow an edit typed into the localization panel, and that edit has no broadcast effect behind
 * it: the other participants are sent nothing to derive it from, so their libraries and this one
 * diverge on the spot and nothing anywhere notices. Scoping the exemption to the moment an effect
 * is being applied is what keeps every byte written here a byte the other machines write too.
 */
let derivedHold: { projectPath: string; depth: number } | null = null;

/**
 * The libraries a live session's participants each rebuild for themselves from one broadcast
 * effect: the translation library and the voice library for whichever language the effect touches.
 *
 * **Named by document kind rather than by paths copied into this module**, because a copied path is
 * the drift this gate cannot survive. `LocalizationService` and `VoiceService` address their files
 * through these same two specs (`spec.pathFor({ locale })`), and `defineDocumentSpec` builds a
 * spec's patterns and its path builder from one `paths` array - so a library that moves takes this
 * gate with it, and there is no second spelling of `editor/localization/<locale>.json` here to fall
 * behind the one those services actually save to.
 */
const DERIVED_LIBRARY_KINDS: ReadonlySet<string> = new Set([
    localizationDocumentSpec.kind,
    voiceDocumentSpec.kind,
]);

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

/**
 * Drop a freeze that belongs to some OTHER project, and leave this one's alone.
 *
 * The distinction is not a nicety. This latch is module-level while `WorkspaceFreezeService` is a
 * singleton re-initialised per project, so the service clears the latch on startup - otherwise a
 * freeze armed for the project that just closed would refuse writes for the one that just opened, on
 * a path comparison that no longer matches anything.
 *
 * But one freeze is armed BEFORE that service exists: a project opened mid-merge is frozen by
 * `workspaceProjectPreflight`, which has to run before the first document is parsed
 * (docs §4.33). An unconditional clear therefore threw it away on every open - measured on a real
 * mid-merge project, where the workspace came up fully writable with the editors holding the
 * author's own side of a conflicted file. The next auto-save would have written that over the
 * merge's result, silently settling every conflict as "mine" with nobody having chosen.
 *
 * Compared through {@link canonical} and {@link fold} rather than by string equality, for the reason
 * `isFrozenProjectData` uses them: the same project arrives here spelled two ways (the main
 * process's `projectPath` uses the platform separator, the renderer's comes out of the project
 * config) and a raw comparison would answer "different project" for both of them.
 */
export function thawForeignProjectWrites(projectPath: string): void {
    if (!frozen) {
        return;
    }
    if (sameProject(frozen.projectPath, projectPath)) {
        return;
    }
    thawProjectWrites();
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

/**
 * Widen a live session's writable set to the derived libraries until the returned function is
 * called, because one broadcast effect is being applied. See {@link derivedHold}.
 *
 * Returns the release rather than exposing an `end` of its own, so the window cannot outlive its
 * caller's `finally` - the same shape as {@link holdProjectWritesForReload}, for a stronger reason:
 * a hold leaked there costs a write that would have been refused anyway, while one leaked here
 * leaves the localization panel quietly writable for the rest of the session.
 *
 * Re-entrant: applying an effect that applies another counts, and only the last release closes the
 * window. Each release is idempotent.
 *
 * **Widens a `live-session` freeze and nothing else.** Under `revision`, `manual`, `merge` or
 * `recovery` there is no session and nothing is deriving anything from anything, so a hold taken
 * while one of those is armed changes nothing at all - it must never be able to turn a total freeze
 * into a partial one.
 */
export function holdDerivedProjectWrites(projectPath: string): () => void {
    if (derivedHold && sameProject(derivedHold.projectPath, projectPath)) {
        derivedHold.depth += 1;
    } else {
        // A window is one project (see the multi-project window model), so a hold naming a
        // different project is a stale one from a project that has already closed.
        derivedHold = { projectPath, depth: 1 };
    }
    const held = derivedHold;
    let released = false;
    return () => {
        if (released || derivedHold !== held) {
            // Identity, not merely "some hold exists": a release arriving after the window was
            // replaced - a project closed and another opened mid-effect - would otherwise decrement
            // a hold it never took and close somebody else's window early.
            return;
        }
        released = true;
        held.depth -= 1;
        if (held.depth <= 0) {
            derivedHold = null;
        }
    };
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
 * Whether a freeze lets this project-relative path be written.
 *
 * The one predicate both halves of the policy ask - the gate below, and the interface that has to
 * decide whether what it is showing can still be changed. Exported so there is a single answer: a
 * surface offering an edit this gate then refuses is the "quietly discarding everything" failure
 * with an encouraging cursor on top of it.
 *
 * Written over every `kind` with no `default` on purpose. A freeze kind added later must not
 * inherit "total" or "partial" by accident; it has to fail to compile here until somebody has
 * decided which of the two it is.
 */
export function freezeAllowsWrite(reason: WorkspaceFreezeReason, projectRelativePath: string): boolean {
    switch (reason.kind) {
        // The total freezes. Nothing the author can do inside one of them produces a write that
        // belongs in the working tree, so none of them has a path to exempt.
        case "revision":
        case "manual":
        case "merge":
        case "recovery":
            return false;
        case "live-session": {
            // Compared the way this module compares every other pair of paths: {@link canonical}
            // for the separator and trailing-slash spellings the two sides arrive in, {@link fold}
            // for the Windows rule that one file answers to several names. A second comparison here
            // that folded differently would make the same file writable through one spelling and
            // refused through another - the two sides of one predicate disagreeing, which
            // `shared/vcs/workingSet.ts` calls the worst outcome this policy can produce.
            //
            // Folding is right here and wrong above `FOLD_CASE` because the questions differ. There
            // the relative path is an input to {@link isVersioned}, the repository's own table, and
            // folding it would widen an exclusion list. Here it is one file named twice - once by
            // the write, once by the session - and on Windows those really are the same file.
            const target = fold(canonical(projectRelativePath));
            return reason.writable.some((writable) => {
                const allowed = fold(canonical(writable));
                // ⚠ **An entry stands for itself and for everything under it.** Every entry used to
                // be one document, and comparing whole paths was the same question either way; a
                // session that carries the asset library also leaves `assets/content` writable, and
                // an asset's bytes live several directories down inside it. A file entry has nothing
                // under it, so this is exactly as strict for the documents it always was strict for -
                // and it is a prefix at a separator, never a string prefix, so `assets/contentious`
                // is not inside `assets/content`.
                return target === allowed || target.startsWith(`${allowed}/`);
            });
        }
    }
}

/**
 * The gate. Answers the active freeze when one of `paths` is project data that may not be written
 * right now, and announces the refusal on the way out; answers null when the write may proceed.
 *
 * Takes several paths because the verbs that move bytes have two ends and both of them are
 * mutations: `moveFile` and `rename` unlink the source as well as creating the destination, so a
 * check on the destination alone would let a frozen workspace delete a versioned file.
 *
 * Project data the freeze allows - the story document a live session is about, and the libraries a
 * broadcast effect is deriving while {@link holdDerivedProjectWrites} is held - proceeds without a
 * refusal being announced, because nothing was refused. Everything else the repository stores still
 * reaches {@link observeRefusedWrites}: a write that misses the writable set is a component that
 * did not know about the session, and the author has to be told it was dropped.
 */
export function refuseFrozenWrite(...paths: (string | null | undefined)[]): WorkspaceFreeze | null {
    const active = frozen;
    if (!active) {
        return null;
    }
    for (const path of paths) {
        if (typeof path !== "string") {
            continue;
        }
        // Taken from the module that owns the project-root comparison rather than re-derived: this
        // is the same relative path {@link isVersioned} judged, in the same spelling.
        const relative = versionedProjectRelativePath(active.projectPath, path);
        if (relative === null) {
            // Not project data - editor state, a cache, an export to the author's desktop.
            continue;
        }
        if (freezeAllowsWrite(active.reason, relative) || derivedWriteAllowed(active, relative)) {
            continue;
        }
        announceRefusal({ path, reason: active.reason });
        return active;
    }
    return null;
}

/**
 * Whether an open derived-write window covers this path.
 *
 * Three conditions and all of them are load-bearing: the freeze is a session (see
 * {@link holdDerivedProjectWrites} - the other kinds derive nothing), a window is open for that
 * same project, and the path is one of the libraries an effect produces rather than any other file
 * the author might have open.
 */
function derivedWriteAllowed(active: WorkspaceFreeze, projectRelativePath: string): boolean {
    if (active.reason.kind !== "live-session") {
        return false;
    }
    const hold = derivedHold;
    return hold !== null
        && sameProject(hold.projectPath, active.projectPath)
        && isDerivedLibrary(projectRelativePath);
}

/**
 * Whether a project-relative path is one of {@link DERIVED_LIBRARY_KINDS}.
 *
 * Asks which spec OWNS the path rather than which specs match it, and the difference is the whole
 * reason this is not two `spec.matches` calls: `editor/localization/keys.json` matches
 * `editor/localization/<locale>.json` with a locale of `keys`, and the registry is what resolves
 * that overlap in favour of the more specific pattern. The keys registry is a developer-authored
 * list of named strings, not something an effect derives, and a window that let it through would be
 * exactly the divergence this whole mechanism is narrow to avoid.
 *
 * Case-sensitive, because the registry is: a spec matches the casing a document was committed with.
 * That is also the conservative direction for a rule that widens - a library named with unexpected
 * casing is refused and announced, rather than slipped through a window sized for one write.
 */
function isDerivedLibrary(projectRelativePath: string): boolean {
    try {
        const owner = resolveDocumentSpecForPath(projectRelativePath);
        return owner !== undefined && DERIVED_LIBRARY_KINDS.has(owner.spec.kind);
    } catch {
        // The registry rejects a path the document model cannot address at all. That is not a
        // derived library, and this gate may never turn a malformed path into a thrown write.
        return false;
    }
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

/**
 * Whether two spellings name one project directory.
 *
 * The project arrives here spelled several ways - the main process uses the platform separator, the
 * renderer's comes out of the project config, and Windows hands the same directory out under more
 * than one casing - so every comparison of two project roots in this module goes through here. A
 * second one written inline would be the place the spellings stopped agreeing.
 */
function sameProject(a: string, b: string): boolean {
    return fold(canonical(a)) === fold(canonical(b));
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
