import { holdDerivedProjectWrites } from "@/lib/app/writeFreeze";
import { announceClient } from "@/lib/team/teamCall";
import { planLiveDerived } from "@/apps/workspace/modules/story/scene-editor/storyLivePaste";
import type { LiveDerived, LiveDigestScope, LiveUIGraphOp, LiveUIOp } from "@shared/live/ops";
import { uiGraphPartsTouched, uiHasBlueprint } from "@shared/live/uiGraphParts";
import { uiHasElement, uiOwningSurfaceIds, uiPartsTouched } from "@shared/live/uiParts";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import type { StoryBlockId, StoryId } from "@shared/types/story";
import type { TeamLiveSession } from "@shared/types/team";
import { parseVcsRemoteUrl, type VcsCheckpointReason } from "@shared/types/vcs";
import { Service } from "../Service";
import { Services, type ILiveSessionService, type WorkspaceContext } from "../services";
import { CharacterService } from "../core/CharacterService";
import { VersionControlService } from "../core/VersionControlService";
import { WorkspaceFreezeService } from "../core/WorkspaceFreezeService";
import { HistoryService } from "../history/HistoryService";
import { HistoryScopeKind, historyScopeParts, isHistoryScopeOf } from "../history/historyScopes";
import { AssetsService } from "../core/AssetsService";
import { LocalizationService } from "../localization/LocalizationService";
import { rowsSpokenBy } from "../story/characterSweepLive";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import { VoiceService } from "../voice/VoiceService";
import { LiveSession } from "./LiveSession";
import type { LiveSessionDeps, LiveProjectIdentity } from "./liveSessionPorts";
import { createTeamLiveRooms } from "./teamLiveRooms";
import { IDLE_LIVE_SESSION, type LiveEntryFailure, type LiveSessionView } from "./liveSessionView";

/**
 * The live session this window is in, if it is in one.
 *
 * A workspace service because a session is a property of the window rather than of a screen: it
 * outlives every panel that shows it, it holds the workspace's write freeze open, and the story
 * editor's gestures pass through it whether or not anything is on screen to say so.
 *
 * **One session per window, and this owns it.** Not a set: the freeze it arms is a module-level
 * latch carrying one writable path set, and a second session would take the first one's away while
 * its host was still broadcasting effects for it.
 *
 * All of the behaviour is in {@link LiveSession}, which takes its world as an argument. What is
 * here is the wiring - which service answers which port - and it is the only part that cannot be
 * exercised without a workspace.
 */

/**
 * What the checkpoint recorded on the way into a session is labelled.
 *
 * `interval` is not a lie about what happened, only about what triggered it: its message is the
 * bare "Checkpoint", which is exactly what this is. The alternatives say something untrue on a
 * permanent revision that travels to collaborators - the author did not close a project, run a
 * build or restore anything - and a reason of its own would have to be added to
 * `VcsCheckpointReason` and to the message table beside it, which is a change to the shared
 * vocabulary rather than to this feature.
 */
const LIVE_CHECKPOINT_REASON: VcsCheckpointReason = "interval";

/**
 * What entering answers before this service has come up.
 *
 * Reached through a workspace that failed to start or one that is being torn down, so it is a
 * defect rather than a state the author is in - but it must still be a refusal rather than a throw
 * out of whatever pressed the control.
 */
const NOT_INITIALIZED: LiveEntryFailure = { kind: "failed", detail: "the live session service is not running" };

export class LiveSessionService extends Service<LiveSessionService> implements ILiveSessionService {
    private session: LiveSession | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        // Everything a session touches on the way in and out has to be up before it can be entered:
        // the sink lives on the story service, the freeze flushes through the save registry, and
        // entering records a checkpoint through version control.
        await depend([
            ctx.services.get<StoryService>(Services.Story),
            ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze),
            ctx.services.get<VersionControlService>(Services.VersionControl),
            ctx.services.get<HistoryService>(Services.History),
        ]);
        this.session = new LiveSession(this.buildDeps(ctx));
    }

    public override dispose(_ctx: WorkspaceContext): void {
        // A session that survived its window would leave the story editor handing gestures to a
        // room nobody is in, and the project frozen with nothing on screen to explain why.
        this.session?.dispose();
        this.session = null;
    }

    /* ------------------------------------------------------------------- reading */

    public getView(): LiveSessionView {
        return this.session?.getView() ?? IDLE_LIVE_SESSION;
    }

    public onChanged(handler: (view: LiveSessionView) => void): () => void {
        return this.session?.onChanged(handler) ?? (() => undefined);
    }

    /** Whether a session owns this story document right now. See {@link LiveSession.ownsStory}. */
    public ownsStory(storyId: StoryId): boolean {
        return this.session?.ownsStory(storyId) ?? false;
    }

    /* ----------------------------------------------------------------- the acts */

    public open(input: { storyId: StoryId; title?: string }): Promise<LiveEntryFailure | null> {
        return this.session?.open(input) ?? Promise.resolve<LiveEntryFailure>(NOT_INITIALIZED);
    }

    public join(input: { session: TeamLiveSession | string }): Promise<LiveEntryFailure | null> {
        return this.session?.join(input) ?? Promise.resolve<LiveEntryFailure>(NOT_INITIALIZED);
    }

    public leave(): Promise<void> {
        return this.session?.leave() ?? Promise.resolve();
    }

    /**
     * Say that this window is writing a row, or that it has stopped.
     *
     * The seam the story editor takes and gives back a row through - see
     * {@link LiveSession.claimRow} for what each role does with it. Silent outside a session, which
     * is what lets the editor call it without asking whether there is one.
     */
    public claimRow(storyId: StoryId, blockId: StoryBlockId, holding: boolean): void {
        this.session?.claimRow(storyId, blockId, holding);
    }

    /**
     * Say that this window is editing one character record, or that it has stopped.
     *
     * The cast's door beside the story's, and the same bargain: silent outside a session, so the
     * panel calls it without asking whether there is one. There is no document id to pass because
     * there is one cast per project.
     */
    public claimCharacter(characterId: string, holding: boolean): void {
        this.session?.claimCharacter(characterId, holding);
    }

    /**
     * Say that this window is writing one translation, or that it has stopped.
     *
     * The third door beside the row's and the record's, and the same bargain: silent outside a
     * session, so the table calls it without asking whether there is one. The language is part of
     * the address because the same line has an entry in every one of them.
     */
    public claimTranslation(locale: string, unitId: string, holding: boolean): void {
        this.session?.claimTranslation(locale, unitId, holding);
    }

    /**
     * Say that this window is editing one asset record, or that it has stopped.
     *
     * The library's door beside the other three, and the same bargain: silent outside a session. No
     * asset type, because an id is unique across the whole library.
     */
    public claimAsset(assetId: string, holding: boolean): void {
        this.session?.claimAsset(assetId, holding);
    }

    /**
     * Say that this window is editing one interface element, or that it has stopped.
     *
     * The canvas's door beside the row's, the record's, the line's and the asset's, and the same
     * bargain: silent outside a session, so the properties panel calls it without asking whether
     * there is one. The component id is part of the address because a component definition owns its
     * own element map.
     */
    public claimUIElement(componentId: string | null, elementId: string, holding: boolean): void {
        this.session?.claimUIElement(componentId, elementId, holding);
    }

    /**
     * Say that this window is editing one blueprint node, or that it has stopped.
     *
     * The element's counterpart on the blueprint canvas. Both the blueprint and the graph are part
     * of the address because node ids are not unique across the document.
     */
    public claimUINode(blueprintId: string, graphId: string, nodeId: string, holding: boolean): void {
        this.session?.claimUINode(blueprintId, graphId, nodeId, holding);
    }

    /** Send the inverse of this window's last operation. False when there is none; the view says why. */
    public undo(): boolean {
        return this.session?.undo() ?? false;
    }

    public redo(): boolean {
        return this.session?.redo() ?? false;
    }

    /* ------------------------------------------------------------------- wiring */

    /**
     * Apply one interface or blueprint operation, and answer every unit it changed.
     *
     * **The one place the seam between the two documents is handled, and the reason it lives in the
     * wiring rather than in a service.** Applying an interface delta runs
     * `UIBlueprintLifecycleCoordinator` behind it, which writes `uigraphs.json` to keep the private
     * blueprints aligned with the Surfaces and widgets that now exist. That write is DERIVED: every
     * machine performs it from the same effect and reaches the same records, which is why the ids it
     * mints come from the owner key (see `derivedBlueprintId`). So it must not become an operation of
     * its own - `UIGraphService.holdDerived` stands the sink aside for the length of it and answers
     * with what it wrote, and what it wrote is fingerprinted here like everything else.
     *
     * ⚠ The Surface owner map is read BEFORE applying. Which Surface an element belongs to is a
     * question about the tree, and for an element the delta is deleting the only place left to ask is
     * the state before - so a digest taken afterwards alone would fingerprint every Surface except
     * the one the author just changed.
     */
    private applyInterfaceOp(ctx: WorkspaceContext, op: LiveUIOp | LiveUIGraphOp): readonly LiveDigestScope[] {
        const uidoc = ctx.services.get<UIDocumentService>(Services.UIDocument);
        const uigraphs = ctx.services.get<UIGraphService>(Services.UIGraph);
        const scopes: LiveDigestScope[] = [];
        if (op.op === "write-ui") {
            const ownersBefore = uiOwningSurfaceIds(uidoc.getDocument());
            const derived = uigraphs.holdDerived(() => uidoc.applyLiveOp(op));
            const touched = uiPartsTouched(ownersBefore, uidoc.getDocument(), op.parts);
            for (const surfaceId of touched.surfaces) {
                scopes.push({ of: "ui-surface", surfaceId });
            }
            for (const componentId of touched.components) {
                scopes.push({ of: "ui-component", componentId });
            }
            if (touched.shell) {
                scopes.push({ of: "ui-shell" });
            }
            if (derived) {
                const reconciled = uiGraphPartsTouched(derived);
                for (const blueprintId of reconciled.blueprints) {
                    scopes.push({ of: "ui-blueprint", blueprintId });
                }
                if (reconciled.shell) {
                    scopes.push({ of: "ui-graph-shell" });
                }
            }
            return scopes;
        }
        uigraphs.applyLiveOp(op);
        const touched = uiGraphPartsTouched(op.parts);
        for (const blueprintId of touched.blueprints) {
            scopes.push({ of: "ui-blueprint", blueprintId });
        }
        if (touched.shell) {
            scopes.push({ of: "ui-graph-shell" });
        }
        return scopes;
    }

    private uiDocumentOrNull(ctx: WorkspaceContext): UIDocument | null {
        try {
            return ctx.services.get<UIDocumentService>(Services.UIDocument).getDocument();
        } catch {
            return null;
        }
    }

    private uiGraphsOrNull(ctx: WorkspaceContext): UIGraphDocument | null {
        try {
            return ctx.services.get<UIGraphService>(Services.UIGraph).getDocument();
        } catch {
            return null;
        }
    }

    private buildDeps(ctx: WorkspaceContext): LiveSessionDeps {
        const story = (): StoryService => ctx.services.get<StoryService>(Services.Story);
        const characters = (): CharacterService => ctx.services.get<CharacterService>(Services.Character);
        const localization = (): LocalizationService => ctx.services.get<LocalizationService>(Services.Localization);
        const assets = (): AssetsService => ctx.services.get<AssetsService>(Services.Assets);
        const voice = (): VoiceService => ctx.services.get<VoiceService>(Services.Voice);
        const version = (): VersionControlService => ctx.services.get<VersionControlService>(Services.VersionControl);
        const freeze = (): WorkspaceFreezeService => ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
        const uidoc = (): UIDocumentService => ctx.services.get<UIDocumentService>(Services.UIDocument);
        const uigraphs = (): UIGraphService => ctx.services.get<UIGraphService>(Services.UIGraph);

        return {
            instance: async () => {
                const project = await this.identity(ctx);
                if (project === null || project.remoteOrigin === null) {
                    return null;
                }
                // Learnt from the answer rather than worked out: a renderer that could compose an
                // instance id could compose somebody else's. Announcing twice is defined to be
                // ordinary, so asking here costs nothing that the workspace's own announcement owns.
                const answered = await announceClient(project.remoteOrigin, { project: project.repositoryId });
                return answered.ok ? answered.value.id : null;
            },
            project: () => this.identity(ctx),
            rooms: remoteOrigin => createTeamLiveRooms(remoteOrigin),
            story: {
                setSink: sink => story().setOperationSink(sink),
                listStories: () => story().listStories().map(entry => entry.id),
                loadAll: async () => {
                    const loaded: StoryId[] = [];
                    for (const entry of story().listStories()) {
                        try {
                            await story().loadStory(entry.id);
                            loaded.push(entry.id);
                        } catch (error) {
                            // Skipped rather than fatal, for the reason the speaker sweep skips one: a
                            // session refused because an unrelated story is corrupt would be worse than
                            // one that leaves that story out of what it carries.
                            console.warn(`[live] could not read story ${entry.id} for the session:`, error);
                        }
                    }
                    return loaded;
                },
                rowsSpokenBy: characterId => rowsSpokenBy(story(), characterId),
                document: storyId => {
                    try {
                        return story().getStoryDocument(storyId);
                    } catch {
                        // Not loaded here. A story this window is not holding is one no operation
                        // can be applied to, which the caller reads as "nothing to invert against".
                        return null;
                    }
                },
                applyOp: (storyId, op) => story().applyLiveOp(storyId, op),
                adoptDerived: derived => this.adoptDerived(ctx, derived),
            },
            cast: {
                setSink: sink => characters().setOperationSink(sink),
                view: () => characters().castView(),
                applyOp: op => characters().applyLiveOp(op),
            },
            localization: {
                setSink: sink => localization().setOperationSink(sink),
                loadAll: () => localization().loadAllDocuments(),
                units: locale => localization().unitsOf(locale),
                applyOp: op => localization().applyLiveOp(op),
            },
            voice: {
                setSink: sink => voice().setOperationSink(sink),
                loadAll: () => voice().loadAllDocuments(),
                units: locale => voice().unitsOf(locale),
                applyOp: op => voice().applyLiveOp(op),
            },
            assets: {
                setSink: (sink, blobs) => assets().setOperationSink(sink, blobs),
                // No load step, unlike the two libraries: an asset shard is read as the workspace
                // starts rather than when a panel opens it, so this only says which ones are there.
                shardTypes: () => assets().shardTypes(),
                records: assetType => assets().recordsOf(assetType),
                hasRecord: (assetType, assetId) => assets().recordOf(assetType, assetId) !== null,
                resumePayloads: () => assets().resumePayloads(),
                folderCategories: () => assets().folderCategories(),
                folders: category => assets().foldersOf(category),
                applyOp: op => assets().applyLiveOp(op),
            },
            ui: {
                setSink: sink => {
                    uidoc().setOperationSink(sink?.ui ?? null);
                    uigraphs().setOperationSink(sink?.graphs ?? null);
                },
                // No load step: both documents are read as the workspace starts. What this asks is
                // whether they are there - a workspace that failed to bring one up carries neither,
                // and the write boundary then goes on refusing both.
                held: () => this.uiDocumentOrNull(ctx) !== null && this.uiGraphsOrNull(ctx) !== null,
                document: () => this.uiDocumentOrNull(ctx),
                graphs: () => this.uiGraphsOrNull(ctx),
                hasElement: ref => uiHasElement(this.uiDocumentOrNull(ctx), ref),
                hasBlueprint: blueprintId => uiHasBlueprint(this.uiGraphsOrNull(ctx), blueprintId),
                applyOp: op => this.applyInterfaceOp(ctx, op),
            },
            version: {
                checkpoint: async () => (await version().createCheckpoint(LIVE_CHECKPOINT_REASON))?.revision ?? null,
                head: async () => (await version().getInfo())?.head ?? null,
                hasUncommittedChanges: async () => {
                    // A real scan, which this service is otherwise careful never to do on its own.
                    // Entering a session is an explicit act by a person, and the cheap signal
                    // ("would an automatic checkpoint record anything") answers false when no
                    // scheduler is running - which here would mean skipping the checkpoint that
                    // stands between the author's uncommitted work and the sync about to land on it.
                    const status = await version().refreshStatus();
                    return status !== null && !status.clean;
                },
                push: async () => {
                    await version().push();
                },
                sync: async () => ({ conflicts: (await version().sync()).conflicts }),
            },
            freeze: {
                reason: () => freeze().getReason(),
                arm: async input => {
                    await freeze().freeze({
                        kind: "live-session",
                        session: input.session,
                        writable: input.writable,
                    });
                },
                lift: session => {
                    const reason = freeze().getReason();
                    if (reason?.kind === "live-session" && reason.session === session) {
                        // Only this session's. The latch is module-level, and a freeze armed by
                        // something else in the meantime is not this session's to lift.
                        freeze().thaw();
                    }
                },
            },
            history: {
                forgetStoryScenes: storyId => {
                    ctx.services.get<HistoryService>(Services.History).clearMatching(scopeId =>
                        isHistoryScopeOf(scopeId, HistoryScopeKind.StoryScene)
                        && historyScopeParts(scopeId)[0] === storyId);
                },
            },
            now: () => Date.now(),
            schedule: (delayMs, run) => {
                const timer = setTimeout(run, delayMs);
                return () => clearTimeout(timer);
            },
        };
    }

    private async identity(ctx: WorkspaceContext): Promise<LiveProjectIdentity | null> {
        const version = ctx.services.get<VersionControlService>(Services.VersionControl);
        const info = await version.getInfo();
        if (info === null) {
            return null;
        }
        const remote = await version.getRemote();
        const parsed = remote === null ? null : parseVcsRemoteUrl(remote);
        return {
            repositoryId: info.repositoryId,
            projectPath: ctx.project.getConfig().projectPath,
            remoteOrigin: parsed?.origin ?? null,
        };
    }

    /**
     * Write the entries one effect derived into this machine's own libraries.
     *
     * The window in which they may be written at all: the hold widens a session's freeze for the
     * length of this call and no longer, because a translation written outside it - typed into the
     * localization panel, say - has no effect behind it for anybody else to derive the same entry
     * from, and the two libraries diverge on the spot with nothing anywhere noticing.
     *
     * Read through `planLiveDerived` rather than written as it arrived. What is in the message came
     * off another machine's Studio, of another version, and one value of the wrong type would go
     * straight into a translation file; the paster's own side has always read it field by field, and
     * a second, more trusting reader here is a way for two libraries to end up holding different
     * things.
     *
     * ⚠ **A locale whose document is not open here is loaded and adopted afterwards, not skipped.**
     * Loading is asynchronous and this runs inside applying an effect, which is synchronous and must
     * stay so - so the synchronous part does what it can and the rest is finished on its own. It
     * cannot be dropped: a machine that has never opened the Japanese library would then be missing
     * entries every machine that had it open has, for good and with nothing anywhere saying so,
     * which is precisely the divergence carrying the entries exists to prevent.
     */
    private adoptDerived(ctx: WorkspaceContext, derived: LiveDerived): readonly LiveDigestScope[] {
        const projectPath = ctx.project.getConfig().projectPath;
        const plans = planLiveDerived(derived);
        const later: (() => Promise<void>)[] = [];
        /**
         * Every library this derivation lands in, for the effect's digests.
         *
         * ⚠ **Named from the PLAN rather than from what was written**, and the difference is the
         * whole point. A library this window has not opened yet is adopted on its own afterwards -
         * loading is asynchronous and this is not - so a list of what has already landed would leave
         * exactly that language unfingerprinted, which is the half that went missing unnoticed once
         * before. Naming it here says "this effect changes the Japanese library"; the digest is then
         * computed after the synchronous part, and a machine that never finished the rest disagrees
         * with the room and leaves.
         */
        const touched = [
            ...plans.translations.writes.map((write): LiveDigestScope =>
                ({ of: "translations", locale: write.locale })),
            ...plans.voice.writes.map((write): LiveDigestScope => ({ of: "takes", locale: write.locale })),
        ];
        const release = holdDerivedProjectWrites(projectPath);
        try {
            const localization = ctx.services.get<LocalizationService>(Services.Localization);
            for (const write of plans.translations.writes) {
                if (localization.getDocumentIfLoaded(write.locale)) {
                    localization.adoptUnits(write.locale, write.units);
                } else {
                    later.push(async () => {
                        await localization.loadDocument(write.locale);
                        this.holding(projectPath, () => localization.adoptUnits(write.locale, write.units));
                    });
                }
            }
            const voice = ctx.services.get<VoiceService>(Services.Voice);
            for (const write of plans.voice.writes) {
                if (voice.getDocumentIfLoaded(write.locale)) {
                    voice.adoptUnits(write.locale, write.units);
                } else {
                    later.push(async () => {
                        await voice.loadDocument(write.locale);
                        this.holding(projectPath, () => voice.adoptUnits(write.locale, write.units));
                    });
                }
            }
        } catch (error) {
            // An effect must land whatever the libraries make of what came with it: the document is
            // what every machine in the room has to agree about.
            console.warn("[LiveSession] adopting the entries an effect derived failed", error);
        } finally {
            release();
        }
        for (const finish of later) {
            // One at a time and never awaited by the caller: this is the tail of applying an effect,
            // and the effect has landed whatever the libraries make of it.
            void finish().catch(error => {
                console.warn("[LiveSession] opening a library to adopt what an effect derived failed", error);
            });
        }
        return touched;
    }

    /** Run one write inside the window a session's freeze leaves open for derived entries. */
    private holding(projectPath: string, write: () => void): void {
        const release = holdDerivedProjectWrites(projectPath);
        try {
            write();
        } finally {
            release();
        }
    }
}
