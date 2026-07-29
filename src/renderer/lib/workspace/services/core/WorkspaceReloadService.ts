import type { TranslationKey } from "@shared/i18n";
import { translate } from "@/lib/i18n";
import { holdProjectWritesForReload } from "@/lib/app/writeFreeze";
import { Service } from "../Service";
import { Services, type IWorkspaceReloadService, type WorkspaceContext } from "../services";
import { SaveStatusService, STORAGE_CONSOLE_CHANNEL } from "../autosave/SaveStatusService";
import { ConsoleService } from "./ConsoleService";
import { UIService } from "./UIService";
import { NotificationType } from "../ui/types";
// Type-only, all of them. The participants below are resolved from the registry at reload time, so
// this module names them without importing any of them as a value - which is what keeps a service
// that reloads every document out of every document service's import graph.
import type { AssetsService } from "./AssetsService";
import type { CharacterService } from "./CharacterService";
import type { ProjectService } from "./ProjectService";
import type { StoryService } from "../story/StoryService";
import type { LocalizationService } from "../localization/LocalizationService";
import type { VoiceService } from "../voice/VoiceService";
import type { UIDocumentService } from "../ui-editor/UIDocumentService";
import type { UIGraphService } from "../ui-editor/UIGraphService";
import type { UIEditorHistoryService } from "../ui-editor/UIEditorHistoryService";
import type { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import type { VariableRegistryService } from "../variables/VariableRegistryService";
import { EventEmitter } from "../ui/EventEmitter";

/**
 * Why the working tree stopped being what the editors are showing.
 *
 * `thaw` is the first caller and `restore` is the second (the `vcs:working-tree-changed` event plan
 * §4.4 books as a V4 acceptance item, which is the same mechanism seen from the other end). They are
 * distinguished only for the console line: the work is identical, and it has to be, because the
 * failure being prevented is identical too.
 */
export type WorkspaceReloadCause = "thaw" | "restore" | "external";

export type WorkspaceReloadResult = {
    cause: WorkspaceReloadCause;
    /** Participant ids that re-read successfully. */
    reloaded: string[];
    /** Participants that did not, each keeping whatever it already held. */
    failures: { id: string; labelKey: TranslationKey; error: unknown }[];
};

type ReloadParticipant = {
    id: string;
    labelKey: TranslationKey;
    /**
     * Re-read this service's half of the working tree. Must read before it drops anything: throwing
     * has to leave the service with what it had, never with half a document.
     */
    reload: (ctx: WorkspaceContext) => Promise<void>;
};

/**
 * Everything that holds project data in memory, in the order it has to be re-read.
 *
 * **This list is the answer to "who participates?".** It is a static table rather than a runtime
 * registry precisely so the question can be answered by reading one place - a service that forgot to
 * register would be invisible, and the cost of a document service missing from a reload is that its
 * pre-reload memory gets written over the author's working tree.
 *
 * Order is not cosmetic:
 *
 *  - the project manifest first, because the localization and voice locale lists come out of it;
 *  - assets before characters and stories, because both of those re-take asset locks as they load;
 *  - the interface blueprints before the variable registry, which seeds itself from them on a project
 *    that predates the registry.
 *
 * Absent on purpose: `PanelStateService`, `RecentColorsService`, the console and the notification
 * history. They live under `.nlstudio/`, are excluded from the repository by `isVersioned`, and are
 * not frozen either - the editor's own state is not the author's project.
 */
const RELOAD_PARTICIPANTS: readonly ReloadParticipant[] = [
    {
        id: "project",
        labelKey: "workspace.shell.save.stores.project",
        reload: async ctx => {
            await ctx.services.get<ProjectService>(Services.Project).reloadProjectConfig();
        },
    },
    {
        id: "assets",
        labelKey: "workspace.shell.save.stores.assets",
        reload: ctx => ctx.services.get<AssetsService>(Services.Assets).reloadFromDisk(),
    },
    {
        id: "characters",
        labelKey: "workspace.shell.save.stores.characters",
        reload: ctx => ctx.services.get<CharacterService>(Services.Character).reloadFromDisk(),
    },
    {
        id: "story",
        labelKey: "workspace.shell.save.stores.story",
        reload: ctx => ctx.services.get<StoryService>(Services.Story).reloadFromDisk(),
    },
    {
        id: "uiDocument",
        labelKey: "workspace.shell.save.stores.uiDocument",
        // `load()` re-reads and replaces outright - it is what project open calls - so there is
        // nothing to add here.
        reload: async ctx => {
            await ctx.services.get<UIDocumentService>(Services.UIDocument).load();
        },
    },
    {
        id: "uiGraph",
        labelKey: "workspace.shell.save.stores.uiGraph",
        reload: async ctx => {
            await ctx.services.get<UIGraphService>(Services.UIGraph).load();
        },
    },
    {
        id: "variables",
        labelKey: "workspace.shell.save.stores.variables",
        // `load()` clears the corrupt latch at its start (the H2b convention), so a registry that is
        // unreadable at reload time lands in the same "not loaded, refuses to save" state as at
        // project open instead of throwing through the reload.
        reload: async ctx => {
            await ctx.services.get<VariableRegistryService>(Services.VariableRegistry).load();
        },
    },
    {
        id: "localization",
        labelKey: "workspace.shell.save.stores.localization",
        reload: ctx => ctx.services.get<LocalizationService>(Services.Localization).reloadFromDisk(),
    },
    {
        id: "voice",
        labelKey: "workspace.shell.save.stores.voice",
        reload: ctx => ctx.services.get<VoiceService>(Services.Voice).reloadFromDisk(),
    },
];

type WorkspaceReloadEvents = {
    reloaded: WorkspaceReloadResult;
};

/**
 * "The working tree is no longer what the editors are showing - drop what you hold and re-read."
 *
 * One signal with two callers. `WorkspaceFreezeService.thaw` is the first: a write refused by the
 * freeze latch is a no-op, so the service that tried it keeps the value in memory, and the next
 * successful save puts it on disk. Measured in the running app: a scene created while frozen never
 * reached the disk, then rode the first save after thawing there. Harmless while a freeze is manual -
 * memory holds the author's own work - and fatal for browsing history, where memory holds a PAST
 * revision and the first save after leaving writes it over the working tree. That is the loss the
 * gate exists to prevent, arriving one step later.
 *
 * The second caller is restore (plan 2026-07-27-001 §4.4, `vcs:working-tree-changed`), where the
 * bytes on disk change under the editors without the renderer having written them. Same mechanism,
 * because it is the same failure; that is why this is a service and not a branch inside `thaw`.
 *
 * Three properties, each with a failure behind it:
 *
 *  - **Nothing is written while it runs.** Writes are held off at the boundary for the whole reload
 *    (`holdProjectWritesForReload`), which closes the window between "the freeze is gone" and "memory
 *    has been replaced" - a pending auto-save firing in there would write the bytes being discarded.
 *  - **Debts do not survive it.** Every saver abandons what it owes *before* anything is read, rather
 *    than flushing it: a debt owed from before the reload is owed on memory the reload throws away.
 *  - **A failure leaves the stale document, not half of one.** Each participant reads before it drops,
 *    each is isolated from the others, and what could not be re-read is named to the author.
 */
export class WorkspaceReloadService extends Service<WorkspaceReloadService> implements IWorkspaceReloadService {
    private readonly events = new EventEmitter<WorkspaceReloadEvents>();
    private inFlight: Promise<WorkspaceReloadResult> | null = null;
    private generation = 0;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        // The debt-dropping step goes through the saver registry, so it has to be up first.
        await depend([ctx.services.get<SaveStatusService>(Services.SaveStatus)]);
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.inFlight = null;
        this.events.clear();
    }

    /**
     * Drop every in-memory document and read the working tree again.
     *
     * Coalesced rather than queued: two causes arriving together (a thaw, and the restore that caused
     * it) must not read the disk twice or interleave two passes over the same services, and the
     * second caller wants the same answer the first is already getting.
     */
    public reload(cause: WorkspaceReloadCause): Promise<WorkspaceReloadResult> {
        if (this.inFlight) {
            return this.inFlight;
        }
        const task = this.run(cause);
        this.inFlight = task;
        // Cleared on the settled view of the same work, so a rejected reload cannot leave the service
        // permanently claiming one is in flight - nor surface as an unhandled rejection here.
        void task.then(
            () => this.clearInFlight(task),
            () => this.clearInFlight(task),
        );
        return task;
    }

    /**
     * How many reloads this workspace has done. The editor area keys its tabs on it, so every open
     * tab re-resolves its subject after a reload; see {@link onReloaded}.
     */
    public getGeneration(): number {
        return this.generation;
    }

    /**
     * Fires once per reload, after writes are writable again.
     *
     * Subscribed by the editor area, which is where the *other* half of this problem lives: an open
     * tab can name a scene, graph or asset that the re-read tree no longer contains - not
     * hypothetically, that is exactly what the measured repro leaves behind. Rather than teach one
     * resolver about every tab kind, the tabs are remounted, so each one re-runs the load it already
     * has and falls into the "not found" state it already renders.
     */
    public onReloaded(handler: (result: WorkspaceReloadResult) => void): () => void {
        return this.events.on("reloaded", handler);
    }

    private clearInFlight(task: Promise<WorkspaceReloadResult>): void {
        if (this.inFlight === task) {
            this.inFlight = null;
        }
    }

    private async run(cause: WorkspaceReloadCause): Promise<WorkspaceReloadResult> {
        const ctx = this.getContext();
        const release = holdProjectWritesForReload(ctx.project.getConfig().projectPath);
        const reloaded: string[] = [];
        const failures: WorkspaceReloadResult["failures"] = [];

        try {
            await ctx.services.get<SaveStatusService>(Services.SaveStatus).prepareForReload();
            this.dropUndoHistories(ctx);

            for (const participant of RELOAD_PARTICIPANTS) {
                try {
                    await participant.reload(ctx);
                    reloaded.push(participant.id);
                } catch (error) {
                    failures.push({ id: participant.id, labelKey: participant.labelKey, error });
                    this.logStorage("error", translate("workspace.shell.reload.consoleFailed", {
                        label: translate(participant.labelKey),
                        error: String((error as Error)?.message ?? error),
                    }));
                }
            }
        } finally {
            // Before the event and the generation bump: a tab that remounts and saves immediately must
            // find the workspace writable, or the reload would have invented a new refused write.
            release();
        }

        this.generation += 1;
        const result: WorkspaceReloadResult = { cause, reloaded, failures };
        this.logStorage(failures.length > 0 ? "error" : "success", translate("workspace.shell.reload.console", {
            cause,
            count: String(reloaded.length),
        }));
        if (failures.length > 0) {
            this.reportFailures(failures);
        }
        this.events.emit("reloaded", result);
        return result;
    }

    /**
     * Throw away the undo stacks.
     *
     * They are the one other place holding pre-reload documents: an undo snapshot taken before the
     * re-read is a whole `UIDocument` (or blueprint) from the version that is no longer on disk, and
     * one Ctrl+Z would write it back - the same loss as a stale auto-save, through a different door.
     * Losing the ability to undo across a reload is the correct trade: there is nothing coherent to
     * undo *to*.
     */
    private dropUndoHistories(ctx: WorkspaceContext): void {
        try {
            ctx.services.get<UIEditorHistoryService>(Services.UIEditorHistory).clear();
        } catch (error) {
            console.warn("[WorkspaceReload] could not clear the surface undo history", error);
        }
        try {
            ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint).clearBlueprintHistory();
        } catch (error) {
            console.warn("[WorkspaceReload] could not clear the blueprint undo history", error);
        }
    }

    /**
     * One sticky notice naming what could not be re-read.
     *
     * Sticky and not silent: the author is looking at a panel whose contents are from before the
     * reload, and a stale document that says nothing about being stale is how the next save becomes a
     * surprise.
     */
    private reportFailures(failures: WorkspaceReloadResult["failures"]): void {
        const notifications = this.getNotifications();
        if (!notifications) {
            return;
        }
        notifications.showSticky({
            type: NotificationType.Error,
            message: translate("workspace.shell.reload.failedTitle"),
            detail: translate("workspace.shell.reload.failedDetail", {
                stores: failures.map(failure => translate(failure.labelKey)).join(", "),
            }),
        });
    }

    private logStorage(level: "error" | "success", message: string): void {
        try {
            this.getContext().services.get<ConsoleService>(Services.Console)
                .log(STORAGE_CONSOLE_CHANNEL, level, message, { source: "Storage" });
        } catch {
            // Reporting a reload must never be the reason one throws - during teardown the console
            // service can already be gone.
        }
    }

    private getNotifications(): UIService["notifications"] | null {
        try {
            return this.getContext().services.get<UIService>(Services.UI).notifications;
        } catch {
            return null;
        }
    }
}
