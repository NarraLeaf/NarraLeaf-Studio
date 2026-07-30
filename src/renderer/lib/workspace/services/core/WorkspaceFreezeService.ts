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
        this.unobserve = observeProjectWriteFreeze((freeze) => {
            this.events.emit("changed", freeze?.reason ?? null);
            getInterface().workspace.reportWriteFreeze(freeze?.reason.kind ?? null);
        });
        // Main starts the production build and the Preview runtime itself, so it has to be told;
        // greying the two controls is affordance, not enforcement. Reported here as well as on every
        // change because the latch above is module-level and never persisted: a window that reloads
        // mid-freeze comes back writable, and without this main would keep refusing both for the rest
        // of the session with nothing anywhere to explain why.
        getInterface().workspace.reportWriteFreeze(getProjectWriteFreeze()?.reason.kind ?? null);
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.unobserve?.();
        this.unobserve = null;
        thawProjectWrites();
        this.dropSource();
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
