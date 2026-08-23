import { holdDerivedProjectWrites } from "@/lib/app/writeFreeze";
import { announceClient } from "@/lib/team/teamCall";
import { storyDocumentSpec } from "@shared/documents/specs";
import type { LiveDerived } from "@shared/live/ops";
import type { StoryBlockId, StoryId } from "@shared/types/story";
import type { TeamLiveSession } from "@shared/types/team";
import { parseVcsRemoteUrl, type VcsCheckpointReason } from "@shared/types/vcs";
import { Service } from "../Service";
import { Services, type ILiveSessionService, type WorkspaceContext } from "../services";
import { VersionControlService } from "../core/VersionControlService";
import { WorkspaceFreezeService } from "../core/WorkspaceFreezeService";
import { HistoryService } from "../history/HistoryService";
import { HistoryScopeKind, historyScopeParts, isHistoryScopeOf } from "../history/historyScopes";
import { LocalizationService } from "../localization/LocalizationService";
import { StoryService } from "../story/StoryService";
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

    public join(input: { session: TeamLiveSession | string; storyId: StoryId }): Promise<LiveEntryFailure | null> {
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

    /** Send the inverse of this window's last operation. False when there is none; the view says why. */
    public undo(): boolean {
        return this.session?.undo() ?? false;
    }

    public redo(): boolean {
        return this.session?.redo() ?? false;
    }

    /* ------------------------------------------------------------------- wiring */

    private buildDeps(ctx: WorkspaceContext): LiveSessionDeps {
        const story = (): StoryService => ctx.services.get<StoryService>(Services.Story);
        const version = (): VersionControlService => ctx.services.get<VersionControlService>(Services.VersionControl);
        const freeze = (): WorkspaceFreezeService => ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);

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
            // Through the document spec rather than spelled out here, so this cannot fall behind the
            // path `StoryService` actually writes to. The write boundary compares the two.
            storyDocumentPath: storyId => storyDocumentSpec.pathFor({ storyId }),
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
     * A locale whose document is not loaded here is skipped rather than loaded: loading is
     * asynchronous and this runs inside applying an effect, which is synchronous and must stay so.
     */
    private adoptDerived(ctx: WorkspaceContext, derived: LiveDerived): void {
        const projectPath = ctx.project.getConfig().projectPath;
        const release = holdDerivedProjectWrites(projectPath);
        try {
            const localization = ctx.services.get<LocalizationService>(Services.Localization);
            for (const [locale, units] of Object.entries(derived.translations ?? {})) {
                if (localization.getDocumentIfLoaded(locale)) {
                    localization.adoptUnits(locale, units);
                }
            }
            const voice = ctx.services.get<VoiceService>(Services.Voice);
            for (const [locale, units] of Object.entries(derived.voice ?? {})) {
                if (voice.getDocumentIfLoaded(locale)) {
                    voice.adoptUnits(locale, units);
                }
            }
        } catch (error) {
            // An effect must land whatever the libraries make of what came with it: the document is
            // what every machine in the room has to agree about.
            console.warn("[LiveSession] adopting the entries an effect derived failed", error);
        } finally {
            release();
        }
    }
}
