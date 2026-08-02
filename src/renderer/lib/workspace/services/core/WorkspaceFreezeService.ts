import {
    freezeProjectWrites,
    getProjectWriteFreeze,
    observeProjectWriteFreeze,
    thawProjectWrites,
    type WorkspaceFreezeReason,
} from "@/lib/app/writeFreeze";
import { getInterface } from "@/lib/app/bridge";
import { clearProjectDocumentSource, pushProjectDocumentSource } from "@/lib/app/documentSource";
import type { DocumentSource } from "@shared/documents/documentSource";
import { Service } from "../Service";
import { Services, type IWorkspaceFreezeService, type WorkspaceContext } from "../services";
import { SaveStatusService } from "../autosave/SaveStatusService";
// Type-only: the instance comes from the registry. A value import would put the service that reloads
// every document into the import graph of the one every document write already consults.
import type { WorkspaceReloadService, WorkspaceReloadResult } from "./WorkspaceReloadService";
import { EventEmitter } from "../ui/EventEmitter";

type WorkspaceFreezeEvents = {
    /** Null when the workspace is writable again. */
    changed: WorkspaceFreezeReason | null;
};

/**
 * Tell main what the workspace is showing.
 *
 * The revision travels with the kind because main does not refuse everything while frozen: Dev Mode
 * **runs the focused revision** (plan 2026-07-28-002 §1), and it cannot find one from the kind alone.
 * Main refuses the launch if a `"revision"` freeze arrives without an id, so a caller that drops this
 * argument loses the feature rather than silently running the working tree under a past version's name.
 */
function reportFreezeToHost(reason: WorkspaceFreezeReason | null): void {
    if (reason?.kind === "revision") {
        getInterface().workspace.reportWriteFreeze(reason.kind, reason.revision);
        return;
    }
    getInterface().workspace.reportWriteFreeze(reason?.kind ?? null);
}

/**
 * Whether this project's data may be written, and why not when it may not.
 *
 * A service of its own rather than a field on `VersionControlService`: freeze is a workspace write
 * policy whose causes are not all version control (a quarantined document is the next one), and
 * `VersionControlService` is specifically the client for an OPTIONAL native backend that degrades to
 * "unavailable" - a gate that stops gating when the backend is missing is not a gate.
 *
 * The refusal itself is not implemented here. It lives at the write boundary
 * (`@/lib/app/writeFreeze`, consulted by `BaseFileSystemService` and the privileged facade) because
 * the correctness argument is that no component has to remember anything; this service is the
 * workspace-scoped face of that latch - what the command palette, and later the version rail, drive.
 *
 * **Never persisted.** Freeze is a property of what the author is looking at right now, and a frozen
 * state restored on the next launch would be a project that refuses to save with no visible cause.
 * Teardown thaws for the same reason: the latch is module-level and outlives a project switch.
 */
export class WorkspaceFreezeService extends Service<WorkspaceFreezeService> implements IWorkspaceFreezeService {
    private readonly events = new EventEmitter<WorkspaceFreezeEvents>();
    private unobserve: (() => void) | null = null;
    /** Held for as long as a past revision is on screen; see {@link showRevision}. */
    private releaseSource: (() => void) | null = null;
    /**
     * How many callers are keeping the workspace in the view it is in; see {@link holdRelease}.
     *
     * Counted rather than a flag, the same shape as `holdProjectWritesForReload`: two holders are
     * possible the moment a second thing can change the disk, and with a flag the first release
     * would lift the second holder's hold - which is the failure the hold exists to prevent,
     * arriving through the mechanism meant to prevent it.
     */
    private releaseHolds = 0;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        // Freezing flushes what is owed first, so the saver registry has to be up; thawing re-reads
        // the working tree, so the reload service has to be too - `thaw` is called from a click and
        // cannot wait for a service to come up.
        await depend([
            ctx.services.get<SaveStatusService>(Services.SaveStatus),
            ctx.services.get<WorkspaceReloadService>(Services.WorkspaceReload),
        ]);

        // A project switch re-runs init on the same singleton, and the latch is module-level: a
        // freeze armed for the project that just closed would otherwise refuse writes for the one
        // that just opened, on a path comparison that no longer matches anything.
        this.unobserve?.();
        thawProjectWrites();
        // Same argument for the read side: a source installed for the project that just closed would
        // answer this one's reads out of a repository it has nothing to do with.
        this.dropSource();
        // And the same for a hold: one left over from an operation on the project that just closed
        // would leave this one unable to leave a revision view, for a rewrite that is long over.
        this.releaseHolds = 0;
        this.unobserve = observeProjectWriteFreeze((freeze) => {
            this.events.emit("changed", freeze?.reason ?? null);
            reportFreezeToHost(freeze?.reason ?? null);
        });
        // Main starts the production build and the Preview runtime itself, so it has to be told;
        // greying the two controls is affordance, not enforcement. Reported here as well as on every
        // change because the latch above is module-level and never persisted: a window that reloads
        // mid-freeze comes back writable, and without this main would keep refusing both for the rest
        // of the session with nothing anywhere to explain why.
        reportFreezeToHost(getProjectWriteFreeze()?.reason ?? null);
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.unobserve?.();
        this.unobserve = null;
        thawProjectWrites();
        this.dropSource();
        this.releaseHolds = 0;
        this.events.clear();
    }

    /**
     * Stop writing project data until {@link thaw}.
     *
     * Flushes first, and waits. A refused write is a no-op rather than an error (see the latch), so
     * whatever a saver still owed at the moment of freezing would simply be dropped - the author's
     * own last sentence, lost by the feature that promised not to touch their project.
     */
    public async freeze(reason: WorkspaceFreezeReason): Promise<void> {
        const saveStatus = this.getContext().services.get<SaveStatusService>(Services.SaveStatus);
        await saveStatus.flushAll();
        freezeProjectWrites({ projectPath: this.projectPath(), reason });
    }

    /**
     * Show a past revision in the real editors: freeze, then re-read every document out of that
     * revision. {@link thaw} is how the author comes back.
     *
     * **The order is the whole point.** The freeze is armed BEFORE a single byte of the revision is
     * read, because the moment a service holds a historical document, one auto-save timer is all it
     * takes to write it over the author's working tree - the loss `writeFreeze` exists to prevent,
     * arriving from the other direction. So: flush what is owed, latch, install the source, read.
     * `thaw` closes the mirror image of the same window; the two have to be read together.
     *
     * Awaitable, and slow on purpose: the first read of a revision on a project with a remote fetches
     * fragments over the network (docs/version-control.md §6). The caller shows progress.
     *
     * Nothing here touches the working tree, so nothing here takes a checkpoint. Browsing history has
     * zero side effects (plan §1) - a checkpoint per look would mean the author's timeline grew three
     * revisions they never made because they read it three times.
     */
    public async showRevision(source: DocumentSource, label?: string): Promise<WorkspaceReloadResult> {
        if (source.origin.kind !== "revision") {
            // A working-tree source would freeze the workspace and then show it exactly what it was
            // already showing - inert for no reason, with no way for the author to tell why.
            throw new Error("showRevision needs a revision source; use thaw() to return to the working tree.");
        }
        const projectPath = this.projectPath();
        await this.freeze({ kind: "revision", revision: source.origin.revision, label });
        // Replaces whatever was installed, so revision -> revision is one step and cannot leave the
        // previous one's documents readable underneath.
        this.dropSource();
        this.releaseSource = pushProjectDocumentSource(projectPath, source);
        const reload = this.getContext().services.get<WorkspaceReloadService>(Services.WorkspaceReload);
        return reload.reload("revision", source);
    }

    /**
     * Keep the workspace in the view it is in until the returned function is called, because
     * something is rewriting the files underneath it right now.
     *
     * Deliberately says nothing about version control, and must stay that way (see the class comment
     * on why this service does not know version control exists). What it expresses is general: while
     * a process outside the editors is part-way through changing project data on disk, LEAVING the
     * current view means re-reading a half-written tree - and {@link thaw} is exactly a re-read. The
     * editors would then hold a project that is part one version and part another, and the next save
     * would put that hybrid on disk. Nothing on screen would say so, which is what makes it worth a
     * gate rather than a disabled button.
     *
     * A gate here rather than in the controls, for the reason `writeFreeze` gives for the write
     * boundary: the workspace has ~24 modules, four dock regions, a command palette and global
     * keybindings, and one of them forgetting is data loss. The controls still hide themselves - that
     * is affordance, so nobody presses a dead button - but the correctness does not depend on any of
     * them having remembered.
     *
     * Returns the release rather than exposing an `end`, so a hold cannot outlive its caller's
     * `finally`. Counted (see {@link releaseHolds}), and each release is idempotent: a caller that
     * releases twice must not lift somebody else's hold.
     */
    public holdRelease(): () => void {
        this.releaseHolds += 1;
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            // Never below zero: teardown clears the count outright, and a caller's `finally` can
            // still run after that - a negative count would leave the NEXT project unable to leave a
            // view, with nothing anywhere to say why.
            this.releaseHolds = Math.max(0, this.releaseHolds - 1);
        };
    }

    /** Whether anything is holding the workspace in its current view. Read by `when` predicates. */
    public isReleaseHeld(): boolean {
        return this.releaseHolds > 0;
    }

    /**
     * Let project data be written again, and re-read it from disk.
     *
     * The reload is not a nicety. A refused write is a no-op, so the service that tried it keeps the
     * value in memory - measured in the running app: a scene created while frozen never reached disk,
     * and then rode the next successful save there after thawing. Harmless for a manual freeze, where
     * memory holds the author's own work. Fatal for browsing history, where memory holds a PAST
     * revision and the first save after leaving would write it over the working tree - the loss this
     * gate exists to prevent, arriving one step later. So leaving a freeze drops every in-memory
     * document and reads the working tree again; `WorkspaceReloadService` is the same signal restore
     * uses, for the same reason.
     *
     * Void rather than async, because this is called straight from UI handlers (the command palette,
     * the version rail) and a click has nothing to await. The ordering that matters is not the
     * caller's: writes stay refused from here until the reload has finished, held by the reload
     * itself, so nothing can be written from pre-thaw memory in between.
     */
    public thaw(): void {
        if (!this.isFrozen()) {
            // Nothing was refused, so nothing is holding a value the disk has not got. Re-reading
            // anyway would drop the undo stacks and remount every editor tab for no reason.
            return;
        }
        if (this.isReleaseHeld()) {
            // Refused, not queued: whoever is rewriting the disk leaves the view itself when it is
            // done (that is the contract of {@link holdRelease}'s only caller so far), so a deferred
            // thaw would be a second re-read of a tree that is already being re-read. Nothing is said
            // to the author here either - by the time they could read it, the view they asked to
            // leave has been left. The console line is for us: reaching it means a control offered an
            // affordance it should have hidden.
            console.warn("[WorkspaceFreeze] refused to leave the view while the project files are being rewritten");
            return;
        }
        const reload = this.getContext().services.get<WorkspaceReloadService>(Services.WorkspaceReload);
        // The revision goes first, and it goes before the latch: from here on every read answers from
        // the disk, so the reload below re-reads the working tree - which is the point of it. Ordered
        // the other way round, the pass meant to replace historical memory would read the history back
        // in and then unfreeze on top of it.
        this.dropSource();
        // Arm the hold before the latch comes off, so the two refusals meet with no gap. Ordered the
        // other way round, an auto-save timer landing in between is exactly the write this prevents.
        const reloading = reload.reload("thaw");
        thawProjectWrites();
        void reloading.catch(error => {
            // `reload` collects per-participant failures rather than throwing, so reaching here means
            // the machinery itself broke. The workspace is writable either way, which is why this is
            // logged and not rethrown into a click handler.
            console.warn("[WorkspaceFreeze] the post-thaw reload failed", error);
        });
    }

    public isFrozen(): boolean {
        return this.getReason() !== null;
    }

    /** Why the workspace is frozen, or null when it is not. */
    public getReason(): WorkspaceFreezeReason | null {
        return getProjectWriteFreeze()?.reason ?? null;
    }

    public onChanged(handler: (reason: WorkspaceFreezeReason | null) => void): () => void {
        return this.events.on("changed", handler);
    }

    /** This window's project. Freeze is scoped to it, never to "some project". */
    private projectPath(): string {
        return this.getContext().project.getConfig().projectPath;
    }

    /**
     * Read project data off the disk again.
     *
     * Both the held release AND the unconditional clear: the release is the ordinary path, and the
     * clear is what makes a project switch or a teardown safe even if a source was somehow installed
     * by somebody else - the latch is module-level, and the alternative to being sure is a workspace
     * quietly reading a closed project's repository.
     */
    private dropSource(): void {
        this.releaseSource?.();
        this.releaseSource = null;
        clearProjectDocumentSource();
    }
}
