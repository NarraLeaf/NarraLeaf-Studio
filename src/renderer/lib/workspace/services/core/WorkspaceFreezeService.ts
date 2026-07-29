import {
    freezeProjectWrites,
    getProjectWriteFreeze,
    observeProjectWriteFreeze,
    thawProjectWrites,
    type WorkspaceFreezeReason,
} from "@/lib/app/writeFreeze";
import { Service } from "../Service";
import { Services, type IWorkspaceFreezeService, type WorkspaceContext } from "../services";
import { SaveStatusService } from "../autosave/SaveStatusService";
// Type-only: the instance comes from the registry. A value import would put the service that reloads
// every document into the import graph of the one every document write already consults.
import type { WorkspaceReloadService } from "./WorkspaceReloadService";
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
        this.unobserve = observeProjectWriteFreeze((freeze) => this.events.emit("changed", freeze?.reason ?? null));
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.unobserve?.();
        this.unobserve = null;
        thawProjectWrites();
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
}
