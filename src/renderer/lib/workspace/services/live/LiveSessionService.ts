import { getInterface } from "@/lib/app/bridge";
import { holdDerivedProjectWrites } from "@/lib/app/writeFreeze";
import { announceClient } from "@/lib/team/teamCall";
import { planLiveDerived } from "@/apps/workspace/modules/story/scene-editor/storyLivePaste";
import type { LiveDerived, LiveDigestScope, LiveUIGraphOp, LiveUIOp, LiveVariableOp } from "@shared/live/ops";
import { uiGraphPartsTouched, uiHasBlueprint } from "@shared/live/uiGraphParts";
import { uiHasElement, uiOwningSurfaceIds, uiPartsTouched } from "@shared/live/uiParts";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import type { StoryBlockId, StoryId } from "@shared/types/story";
import type { TeamLiveJoinRule, TeamLiveSession } from "@shared/types/team";
import { parseVcsRemoteUrl, VcsErrorCode, type VcsCheckpointReason } from "@shared/types/vcs";
import type { WindowAppType } from "@shared/types/window";
import { Service } from "../Service";
import { Services, type ILiveSessionService, type WorkspaceContext } from "../services";
import { AppTagService } from "../appTag/AppTagService";
import { BrandService } from "../brand/BrandService";
import { DlcService } from "../dlc/DlcService";
import { CharacterService } from "../core/CharacterService";
import { VcsCallError, VersionControlService } from "../core/VersionControlService";
import { WorkspaceFreezeService } from "../core/WorkspaceFreezeService";
import { HistoryService } from "../history/HistoryService";
import { HistoryScopeKind, historyScopeParts, isHistoryScopeOf } from "../history/historyScopes";
import { AssetsService } from "../core/AssetsService";
import { AssetSetService } from "../assets/AssetSetService";
import { AudioTrackService } from "../audio/AudioTrackService";
import { DictionaryService } from "../dictionary/DictionaryService";
import { LocalizationService } from "../localization/LocalizationService";
import { rowsSpokenBy } from "../story/characterSweepLive";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import { VariableRegistryService } from "../variables/VariableRegistryService";
import { VoiceService } from "../voice/VoiceService";
import { LiveSession } from "./LiveSession";
import type { LiveJoinTarget } from "./liveEntry";
import type { LiveSessionDeps, LiveProjectIdentity } from "./liveSessionPorts";
import { createTeamLiveRooms } from "./teamLiveRooms";
import {
    abandonTransfers,
    collectTransfer,
    listTransfers,
    offerTransfer,
    resumeTransfers,
} from "@/lib/team/teamTransfer";
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
 * A reason of its own, because the sentence it writes is permanent repository content that a
 * collaborator reads: the bare "Checkpoint" the timer records says nothing about why a revision
 * nobody asked for is sitting in front of an afternoon's work, and every other reason says something
 * untrue - the author did not close a project, run a build or restore anything.
 */
const LIVE_CHECKPOINT_REASON: VcsCheckpointReason = "live-session";

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
            // ⚠ And every document a session CARRIES, which is not the same list as the one it is
            // driven from. Entering a room reads all of them into memory before anything is frozen
            // or applied, so a session entered before they are up throws in the middle of entering.
            // That never happened while the only way in was an author pressing a control - by then
            // the workspace has been open for a while - and it happens every time now that a
            // reloaded window takes its own room back up as the workspace starts.
            ctx.services.get<CharacterService>(Services.Character),
            ctx.services.get<LocalizationService>(Services.Localization),
            ctx.services.get<VoiceService>(Services.Voice),
            ctx.services.get<AssetsService>(Services.Assets),
        ]);
        this.session = new LiveSession(this.buildDeps(ctx));
        // Not awaited, and that is the point of it: a workspace must open at the same speed whether
        // or not there is a server to ask, and the answer for nearly every window is "you were in
        // nothing". What it repairs is the room a reload left behind - see `LiveSession.resume`.
        void this.takeUpWhateverThisWindowIsFor();
    }

    /**
     * Whichever of the two things a starting workspace has to do about rooms.
     *
     * A window opened by the launcher to join one was told which; every other window is asking the
     * opposite question, which is whether it is already in one that a reload left behind. They are
     * exclusive by construction - a window handed an intent has never been anywhere - and doing
     * both would have a fresh window asking a server about a room it cannot be in.
     */
    private async takeUpWhateverThisWindowIsFor(): Promise<void> {
        const asked = await this.roomThisWindowWasSentTo();
        if (asked === null) {
            await this.takeUpAnyRoom();
            return;
        }
        await this.joinWhatThisWindowWasSentTo(asked);
    }

    /**
     * The room this window was opened to join, taken up so that it is taken up once.
     *
     * ⚠ **Cleared before it is acted on, not after.** Window props are read afresh by every load
     * of the renderer and survive a reload, so an intent left in place would be carried out again
     * by a window whose author left the room an hour ago - and clearing it afterwards would leave
     * that hole open for the whole of joining. Cleared even where the join then fails: the author
     * is told why, and a window that retried by itself on every reload would be worse.
     */
    private async roomThisWindowWasSentTo(): Promise<LiveJoinTarget | null> {
        try {
            const props = await getInterface().getWindowProps<WindowAppType.Workspace>();
            const asked = props.success ? props.data.joinLive : undefined;
            if (asked === undefined) {
                return null;
            }
            await getInterface().workspace.liveIntentTaken();
            return asked;
        } catch {
            // A window that cannot read its own props is one with nothing to act on. The ordinary
            // resume below is the right thing for it and asks nothing of the author.
            return null;
        }
    }

    /**
     * Join what the launcher found, retrying for as long as the reason is "not connected yet".
     *
     * The socket is opened while the workspace is starting, so the first pass usually runs before
     * this window has an instance id - which is the same race `takeUpAnyRoom` runs, and answered
     * the same way. Every other refusal is final and is left on the view for the author to read.
     */
    private async joinWhatThisWindowWasSentTo(target: LiveJoinTarget): Promise<void> {
        for (const delay of LiveSessionService.RESUME_DELAYS_MS) {
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            if (this.session === null) {
                return;
            }
            const failure = await this.session.join(target);
            if (failure === null || failure.kind !== "no-instance") {
                return;
            }
        }
    }

    /**
     * How long to keep asking whether this window was already in a room, and how often.
     *
     * The socket to the server is opened while the workspace is starting, so the first pass runs
     * before there is anything to ask - and a window that gave up there would go on holding a room
     * open on the server with nobody able to answer an intent in it. Four tries over half a minute
     * covers a connection that is slow rather than absent; a connection that is absent answers
     * `settled` on the first pass and nothing further is asked.
     */
    private static readonly RESUME_DELAYS_MS = [0, 2_000, 6_000, 20_000] as const;

    private async takeUpAnyRoom(): Promise<void> {
        for (const delay of LiveSessionService.RESUME_DELAYS_MS) {
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            if (this.session === null) {
                // The window closed while this was waiting.
                return;
            }
            if (await this.session.resume() === "settled") {
                return;
            }
        }
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

    public open(input: {
        storyId: StoryId;
        title?: string;
        rule?: TeamLiveJoinRule;
    }): Promise<LiveEntryFailure | null> {
        return this.session?.open(input) ?? Promise.resolve<LiveEntryFailure>(NOT_INITIALIZED);
    }

    public join(target: LiveJoinTarget): Promise<LiveEntryFailure | null> {
        return this.session?.join(target) ?? Promise.resolve<LiveEntryFailure>(NOT_INITIALIZED);
    }

    /** Change how people get into the running room. Host only; false where it was refused. */
    public setRule(rule: TeamLiveJoinRule): Promise<boolean> {
        return this.session?.setRule(rule) ?? Promise.resolve(false);
    }

    /** Say yes or no to somebody waiting to be let in. Host only. */
    public answerRequest(instance: string, admit: boolean): Promise<boolean> {
        return this.session?.answerRequest(instance, admit) ?? Promise.resolve(false);
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
     * This window is editing one row of a configuration table, or has stopped.
     *
     * Three doors beside the other four, and the same bargain: silent outside a session. See
     * `LiveSession.claimAppTag` for what a row is and why the project's own defaults are one.
     */
    public claimAppTag(tagId: string, holding: boolean): void {
        this.session?.claimAppTag(tagId, holding);
    }

    public claimDlc(dlcId: string, holding: boolean): void {
        this.session?.claimDlc(dlcId, holding);
    }

    public claimBrandColor(colorId: string, holding: boolean): void {
        this.session?.claimBrandColor(colorId, holding);
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

    /**
     * Say that this window is editing one variable registry entry, or that it has stopped.
     *
     * The fifth door beside the other four, and the same bargain: silent outside a session, so the
     * panel calls it without asking whether there is one.
     */
    public claimVariable(variableId: string, holding: boolean): void {
        this.session?.claimVariable(variableId, holding);
    }

    /** Say that this window is editing one named string, or that it has stopped. Silent outside a session. */
    public claimLocalizationKey(name: string, holding: boolean): void {
        this.session?.claimLocalizationKey(name, holding);
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

    /**
     * Apply one registry operation, and the blueprint sweep a deletion implies.
     *
     * **The sweep is derived, which is what makes a deletion shareable at all.** The effect says the
     * variable is gone; every machine then clears the `Get`/`Set` params that named it out of a
     * blueprint document the room already agrees on, and arrives at the same records. Nothing about
     * those nodes travels, for the criterion that decides every piece of derived work in this design:
     * another machine can compute the same result from the same effect.
     *
     * ⚠ Run through `holdDerived`, so the sweep never becomes a `write-ui-graphs` message of its own -
     * on a host that would be a second broadcast per deletion and a second press of undo, and on a
     * guest an intent for work nobody asked for. What it wrote comes back as the blueprints to
     * fingerprint.
     *
     * ⚠ The sweep runs BEFORE the entry leaves, with the order `deletePersistentVariable` keeps for
     * its own reason: clearing first and failing to remove the entry leaves empty nodes beside a
     * variable that is still there, which is the state neither half of this is allowed to produce.
     */
    private applyVariableOp(ctx: WorkspaceContext, op: LiveVariableOp): readonly LiveDigestScope[] {
        const variables = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
        if (op.op !== "delete-variable") {
            variables.applyLiveOp(op);
            return [];
        }
        const uigraphs = ctx.services.get<UIGraphService>(Services.UIGraph);
        const blueprints = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const swept = uigraphs.holdDerived(() => blueprints.sweepVariableNodeRefs(op.variableId));
        variables.applyLiveOp(op);
        if (swept === null) {
            // No node named it, which is the ordinary case for a variable created in this session.
            return [];
        }
        const touched = uiGraphPartsTouched(swept);
        return [
            ...touched.blueprints.map(blueprintId => ({ of: "ui-blueprint", blueprintId }) as const),
            ...(touched.shell ? [{ of: "ui-graph-shell" } as const] : []),
        ];
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
        const appTags = (): AppTagService => ctx.services.get<AppTagService>(Services.AppTags);
        const dlc = (): DlcService => ctx.services.get<DlcService>(Services.Dlc);
        const brand = (): BrandService => ctx.services.get<BrandService>(Services.Brand);
        const dictionary = (): DictionaryService => ctx.services.get<DictionaryService>(Services.Dictionary);
        const audioTracks = (): AudioTrackService => ctx.services.get<AudioTrackService>(Services.AudioTracks);
        const assetSets = (): AssetSetService => ctx.services.get<AssetSetService>(Services.AssetSets);
        const variables = (): VariableRegistryService =>
            ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
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
            // Bytes, which the rooms above deliberately do not carry. Everything here names a path
            // and the main process does the reading, the writing and the connection.
            transfers: {
                offer: input => offerTransfer(input),
                collect: input => collectTransfer(input),
                abandon: async (remoteOrigin, project, transferIds) => {
                    await abandonTransfers(remoteOrigin, project, transferIds);
                },
                list: () => listTransfers(),
                resume: async (remoteOrigin, project) => {
                    await resumeTransfers(remoteOrigin, project);
                },
            },
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
                loadKeys: () => localization().loadKeysForLive(),
                keys: () => localization().keysIfLoaded(),
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
                noteTransferProgress: () => assets().noteTransferProgress(),
                folderCategories: () => assets().folderCategories(),
                folders: category => assets().foldersOf(category),
                applyOp: op => assets().applyLiveOp(op),
            },
            // The three configuration tables. No load step either, and for the asset library's
            // reason: all three services read their file as the workspace starts.
            appTags: {
                setSink: sink => appTags().setOperationSink(sink),
                document: () => appTags().liveDocument(),
                hasTag: tagId => appTags().getTag(tagId) !== undefined,
                applyOp: op => appTags().applyLiveOp(op),
            },
            dlc: {
                setSink: sink => dlc().setOperationSink(sink),
                document: () => dlc().liveDocument(),
                hasDlc: dlcId => dlc().has(dlcId),
                applyOp: op => dlc().applyLiveOp(op),
            },
            brand: {
                setSink: sink => brand().setOperationSink(sink),
                document: () => brand().liveDocument(),
                hasColor: colorId => brand().getColor(colorId) !== undefined,
                applyOp: op => brand().applyLiveOp(op),
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
            // The three project tables. No load step, with the asset shards: all three are read as
            // the workspace starts rather than when a panel opens them.
            dictionary: {
                setSink: sink => dictionary().setOperationSink(sink),
                document: () => dictionary().documentOrNull(),
                applyOp: op => dictionary().applyLiveOp(op),
            },
            audioTracks: {
                setSink: sink => audioTracks().setOperationSink(sink),
                tracks: () => audioTracks().tracksOrNull(),
                applyOp: op => audioTracks().applyLiveOp(op),
            },
            assetSets: {
                setSink: sink => assetSets().setOperationSink(sink),
                sets: () => assetSets().setsOrNull(),
                applyOp: op => assetSets().applyLiveOp(op),
            },
            variables: {
                setSink: sink => variables().setOperationSink(sink),
                // No load step: the registry is read as the workspace starts. What this asks is
                // whether what is in memory stands for the file on disk - after an unreadable read it
                // does not, and a session must not carry it.
                readable: () => variables().isReadable(),
                entry: variableId => variables().getEntry(variableId) ?? null,
                applyOp: op => this.applyVariableOp(ctx, op),
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
                    try {
                        await version().push();
                        return { diverged: false };
                    } catch (error) {
                        // The one refusal a session can act on, told apart by the code the main
                        // process gives it rather than by the backend's English - see
                        // `VcsBranchDivergedError`. Everything else is somebody else's to explain.
                        if (error instanceof VcsCallError && error.code === VcsErrorCode.BranchDiverged) {
                            return { diverged: true };
                        }
                        throw error;
                    }
                },
                sync: async () => ({ conflicts: (await version().sync()).conflicts }),
                abortMerge: async () => {
                    await version().abortMerge();
                },
                adopt: async revision => {
                    // The same call the version rail's restore makes, said to be for a session:
                    // what changes is the two sentences the revisions carry, which are permanent
                    // repository content a collaborator reads. See `VcsRestoreOptions.purpose`.
                    await version().restoreRevision(revision, { purpose: "live-session" });
                },
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
            memory: {
                // Keyed by repository id rather than by path, for the reason every other identity in
                // this feature is: a folder gets renamed and a repository does not. Written through
                // the whole map because the store holds one value per key, and read defensively
                // because what is on disk was written by some other version of this.
                remember: hosting => {
                    void (async () => {
                        const project = await this.identity(ctx);
                        if (project === null) {
                            return;
                        }
                        const held = await this.hostedSessions();
                        const next = { ...held };
                        if (hosting === null) {
                            delete next[project.repositoryId];
                        } else {
                            next[project.repositoryId] = { story: hosting.story, at: Date.now() };
                        }
                        await getInterface().app.state.setGlobalState("team.hostedLiveSessions", next);
                    })().catch(error => {
                        // A note that could not be written is a reload that will not come back to
                        // its room, and nothing else. Never a reason to refuse a session.
                        console.warn("[LiveSession] could not record what this window is hosting", error);
                    });
                },
                recall: async () => {
                    const project = await this.identity(ctx);
                    if (project === null) {
                        return null;
                    }
                    const held = (await this.hostedSessions())[project.repositoryId];
                    return held && typeof held.story === "string" && typeof held.at === "number"
                        ? { story: held.story as StoryId, at: held.at }
                        : null;
                },
            },
            history: {
                forgetStoryScenes: storyId => {
                    ctx.services.get<HistoryService>(Services.History).clearMatching(scopeId =>
                        isHistoryScopeOf(scopeId, HistoryScopeKind.StoryScene)
                        && historyScopeParts(scopeId)[0] === storyId);
                },
                forgetInterfaceEditors: () => {
                    ctx.services.get<HistoryService>(Services.History).clearMatching(scopeId =>
                        isHistoryScopeOf(scopeId, HistoryScopeKind.UISurface)
                        || isHistoryScopeOf(scopeId, HistoryScopeKind.Blueprint));
                },
            },
            now: () => Date.now(),
            schedule: (delayMs, run) => {
                const timer = setTimeout(run, delayMs);
                return () => clearTimeout(timer);
            },
        };
    }

    /** What every window on this machine has recorded about a session it was hosting. */
    private async hostedSessions(): Promise<Record<string, { story: string; at: number }>> {
        const answer = await getInterface().app.state.getGlobalState("team.hostedLiveSessions");
        const held = answer.success ? answer.data.value : null;
        return held !== null && typeof held === "object" ? held : {};
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
