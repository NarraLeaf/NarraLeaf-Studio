import { getInterface } from "@/lib/app/bridge";
import { getProjectWriteFreeze, isFrozenProjectData } from "@/lib/app/writeFreeze";
import { clearMergeConflictReads } from "@/lib/app/mergeConflictReads";
import type {
    RevisionId,
    VcsAvailability,
    VcsCheckpointReason,
    VcsCommitOptions,
    VcsCommitResult,
    VcsFileChange,
    VcsHistoryEntry,
    VcsInitOptions,
    VcsMergeCompletion,
    VcsMergeDecision,
    VcsMergeDocument,
    VcsMergeState,
    VcsPushResult,
    VcsRepositoryInfo,
    VcsRevisionDiffResult,
    VcsWorkingTreeDiffResult,
    VcsSyncResult,
    VcsSyncState,
    VcsRestoreOptions,
    VcsRestoreResult,
    VcsStatus,
} from "@shared/types/vcs";
import { Service } from "../Service";
import { Services, type IVersionControlService, type WorkspaceContext } from "../services";
import type { GlobalSettingsService } from "../GlobalSettingsService";
import { EventEmitter } from "../ui/EventEmitter";
import { BaseFileSystemService } from "./FileSystem";
import { RevisionDocumentSource } from "./RevisionDocumentSource";
// Type-only: the instance comes from the registry. Version control drives the freeze; the freeze does
// not know version control exists (see WorkspaceFreezeService for why that separation is deliberate).
import type { WorkspaceFreezeService } from "./WorkspaceFreezeService";
// Type-only, same reason. Reached only by `restoreRevision`, for the case where the working tree
// changed under editors that were never frozen.
import type { WorkspaceReloadService } from "./WorkspaceReloadService";

/**
 * A call the main process refused.
 *
 * Carries the `code` the thrower gave itself alongside the sentence it threw, so a surface can tell
 * an ordinary answer ("nothing has changed since the last version") from a failure without matching
 * on English prose. `code` is undefined for everything that threw a plain `Error`, which is most
 * things and is fine: the sentence is then all there is, and it is rendered as it always was.
 */
export class VcsCallError extends Error {
    constructor(message: string | undefined, readonly code: string | undefined) {
        // A refusal with no message at all should still not surface as "undefined". It has not been
        // seen, and the day it is, this reads as a fault rather than as a sentence.
        super(message?.trim() || "Version control refused the request");
        this.name = "VcsCallError";
    }
}

/** The rejection every call in this service throws, from the envelope the host sent back. */
function vcsCallFailed(result: { error?: string; code?: string }): VcsCallError {
    return new VcsCallError(result.error, result.code);
}

/**
 * The renderer's side of version control.
 *
 * Everything here goes over IPC to the per-project session in `VcsManager`; the
 * project path is this window's own and is never a parameter, because Studio is
 * one-project-one-window and a caller that could pass a different one could reach a
 * repository this window does not own.
 *
 * **Never put this on a timer.** `refreshStatus` runs a backend scan, and the scan is
 * not a pure read: discovering a NEW DIRECTORY records it into the repository's
 * staged state, so a directory created and removed between two ticks is reported as a
 * deletion for the rest of the session even though it was never committed - and the
 * author, following the list, commits the removal of something that never existed.
 * Measured by controlled comparison and pinned in `repository.integration.test.ts`;
 * written up as docs/version-control.md §4.17. So: no `setInterval`, no polling, no
 * subscription to an event that fires repeatedly. A refresh happens when a person
 * asks for one, or right after an operation this service itself performed. If you are
 * here to add a timer because the panel feels stale, add a refresh button instead.
 *
 * Availability is asked once and cached. Version control is an OPTIONAL capability -
 * Epic ships no native build for macOS Intel or Windows ARM64 - and "unavailable" is
 * a normal answer with a reason, not an error. Every read below answers empty rather
 * than throwing when there is nothing to report, so a UI does not need a try/catch to
 * render an empty panel; the verbs with no honest empty answer - {@link readBlob},
 * {@link initRepository} and {@link commit} - throw.
 *
 * **The automatic checkpoint lives here too**, in {@link CheckpointScheduler}, because
 * only the renderer knows when a document was actually written. It is driven by
 * `FileSystemService.observeWrites`, never by asking the backend what changed, for the
 * same §4.17 reason the paragraph above gives. Branch and push are still to come and are
 * deliberately not stubbed: a method that resolves without doing anything is worse than
 * one that does not exist.
 *
 * {@link restoreRevision} is the one method here that changes the author's files, and the only
 * one whose failure mode is losing work rather than showing something wrong. Its contract - a
 * checkpoint first, a new revision rather than a rewind, and a full re-read afterwards - is on the
 * method, and none of the three is optional.
 */

type VersionControlServiceEvents = {
    /** Null once the cached snapshot is dropped, e.g. on teardown or after init. */
    statusChanged: VcsStatus | null;
    /**
     * A revision now exists that did not before, so HEAD has moved.
     *
     * Every surface that names a version reads the head for itself - the rail, the switcher menu
     * and the status-bar cell are three separate readers by design - and none of them can see a
     * commit made through another one. Without this they disagree on screen: the rail says `#3`
     * while the cell still says `#2`, which is the contradiction that makes an author stop
     * believing the feature.
     *
     * Fires for the automatic checkpoint too, where it matters more: nobody pressed anything, so
     * there is no other moment at which a surface would think to look.
     *
     * **Not a substitute for a scan.** It says the head moved, never what is in the working tree
     * (see the class comment on why nothing here may refresh a status on its own).
     */
    revisionRecorded: void;
    /**
     * A merge was closed or abandoned here, so anything drawing one has to look again.
     *
     * Separate from {@link revisionRecorded} because abandoning a merge records NO revision and
     * still changes everything about what the rail should say. Folding it into that event would
     * mean announcing a revision that does not exist, which is the kind of small lie the version
     * surfaces have already drifted apart over once.
     *
     * Carries nothing: the state is re-read rather than passed, so two subscribers cannot end up
     * holding different vintages of the same answer.
     */
    mergeChanged: void;
};

/** The settings key holding the checkpoint interval in minutes. 0 disables. */
export const CHECKPOINT_INTERVAL_SETTING = "versionControl.checkpointIntervalMinutes";

/** What the setting means when nobody has set it. Mirrors GLOBAL_STATE_DEFAULTS. */
export const CHECKPOINT_INTERVAL_DEFAULT_MINUTES = 15;

/**
 * How often the scheduler wakes up to check the clock.
 *
 * Independent of the interval so that changing the interval - or setting it to 0 - takes
 * effect on the next beat instead of at the next restart. A beat with nothing to do
 * reads two booleans and a number; it never talks to the backend and it never scans.
 */
export const CHECKPOINT_HEARTBEAT_MS = 30_000;

/** One write, as `FileSystemService.observeWrites` reports it. */
type ObservedWrite = { path: string; ok: boolean };

export interface CheckpointSchedulerDeps {
    /** Read on every beat, not captured, so a changed setting applies immediately. */
    intervalMinutes: () => number;
    /** Whether a write to this absolute path is a change to the versioned project. */
    counts: (absolutePath: string) => boolean;
    /** Whether project data is currently frozen. */
    isFrozen: () => boolean;
    /** Take the checkpoint. Resolving with null means there was nothing to record. */
    checkpoint: () => Promise<unknown>;
    observeWrites: (observer: (write: ObservedWrite) => void) => () => void;
    now?: () => number;
    /** Start the beat; returns a cancel. Injected so tests can beat it by hand. */
    heartbeat?: (beat: () => void, periodMs: number) => () => void;
    onError?: (error: unknown) => void;
}

/**
 * Decides when an automatic checkpoint is due.
 *
 * **It never asks what changed - only whether anything did.** The obvious
 * implementation, a timer that scans the working tree and commits if the scan reports
 * changes, is broken at the backend level: a status scan is not a pure read. Discovering
 * a new directory records it into the repository's staged state, so a directory the
 * author created and removed between two ticks is reported as a DELETION for the rest of
 * the session - a checkpoint following that list would record the removal of something
 * that never existed (docs/version-control.md §4.17, pinned in
 * `repository.integration.test.ts`).
 *
 * So the signal is the one the renderer already has: `FileSystemService.observeWrites`
 * fires for every write Studio performs, and `isVersioned` - reached here through
 * {@link isFrozenProjectData}, the same predicate the freeze gate uses - says whether
 * the path is part of the repository. A thumbnail cache write, a panel-layout write, a
 * build artefact: all observed, none of them a reason to make a revision.
 *
 * The interval is a floor on the gap between checkpoints, measured from the FIRST
 * unrecorded change rather than from the last checkpoint. An author who edits once and
 * stops gets one checkpoint a minute later than they typed, not one every interval
 * forever.
 */
export class CheckpointScheduler {
    private readonly now: () => number;
    private readonly heartbeat: (beat: () => void, periodMs: number) => () => void;
    private stopObserving: (() => void) | null = null;
    private stopBeating: (() => void) | null = null;
    /**
     * When the oldest unrecorded versioned write happened, or null when the working
     * tree has nothing in it that a checkpoint would record.
     */
    private dirtySince: number | null = null;
    /** A checkpoint in flight. Its own beat must not start a second one. */
    private running = false;

    constructor(private readonly deps: CheckpointSchedulerDeps) {
        this.now = deps.now ?? (() => Date.now());
        this.heartbeat = deps.heartbeat ?? ((beat, periodMs) => {
            const timer = setInterval(beat, periodMs);
            return () => clearInterval(timer);
        });
    }

    public start(): void {
        if (this.stopObserving) return;
        this.stopObserving = this.deps.observeWrites((write) => this.noteWrite(write));
        this.stopBeating = this.heartbeat(() => void this.tick(), CHECKPOINT_HEARTBEAT_MS);
    }

    public stop(): void {
        this.stopObserving?.();
        this.stopObserving = null;
        this.stopBeating?.();
        this.stopBeating = null;
        this.dirtySince = null;
    }

    /** Whether a checkpoint would record anything. Exposed for the UI and for tests. */
    public hasUnrecordedChanges(): boolean {
        return this.dirtySince !== null;
    }

    private noteWrite(write: ObservedWrite): void {
        // A failed write left nothing on disk, so there is nothing for a checkpoint to
        // record and nothing to reset the clock for.
        if (!write.ok || !this.deps.counts(write.path)) return;
        this.dirtySince ??= this.now();
    }

    /**
     * One beat. Public so a test can drive it and await the checkpoint it starts.
     *
     * The freeze check is NOT redundant, even though a frozen workspace cannot produce
     * a versioned write in the first place (the latch refuses it before the write is
     * ever reported, so `dirtySince` cannot be set while frozen). It matters for a flag
     * set BEFORE the freeze: without it, an author who edits and then opens a past
     * revision gets a checkpoint appended to their timeline for the act of reading
     * history - and "browsing history has zero side effects" is the decision that
     * shapes the whole feature.
     */
    public async tick(): Promise<void> {
        const minutes = this.deps.intervalMinutes();
        if (!Number.isFinite(minutes) || minutes <= 0) return;
        if (this.dirtySince === null || this.running) return;
        if (this.deps.isFrozen()) return;
        if (this.now() - this.dirtySince < minutes * 60_000) return;

        this.running = true;
        // Cleared before the await, so a write that lands DURING the checkpoint starts a
        // new interval rather than being swallowed by the one being recorded.
        this.dirtySince = null;
        try {
            await this.deps.checkpoint();
        } catch (error) {
            // The change is still unrecorded, so the next beat has to try again.
            this.dirtySince ??= this.now();
            this.deps.onError?.(error);
        } finally {
            this.running = false;
        }
    }
}

export class VersionControlService extends Service<VersionControlService> implements IVersionControlService {
    /**
     * One probe per session, shared by every concurrent caller. Cached because the
     * probe loads a ~29MB native library, not because a second answer would differ.
     */
    private availability: Promise<VcsAvailability> | null = null;
    /**
     * The last scan's result. Deliberately the only cached state that a caller can
     * read without asking for work: it is a SNAPSHOT, and it goes stale the moment
     * the author touches a file. See the class comment for why refreshing it behind
     * their back is not an option.
     */
    private status: VcsStatus | null = null;
    /**
     * History by page. Revisions are immutable, so a page cannot go stale - only get
     * shorter than the truth once this process commits, which is what
     * {@link invalidateHistory} is for. The first read of a project with a remote may go
     * to the network (docs §6), which is the other reason not to repeat it.
     */
    private readonly history = new Map<string, Promise<VcsHistoryEntry[]>>();
    private readonly events = new EventEmitter<VersionControlServiceEvents>();
    private settings: GlobalSettingsService | null = null;
    private scheduler: CheckpointScheduler | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        try {
            const settings = ctx.services.get<GlobalSettingsService>(Services.GlobalSettings);
            await depend([settings]);
            this.settings = settings;
        } catch {
            // No settings service means the interval cannot be read, so the scheduler
            // falls back to the shipped default rather than refusing to exist.
            this.settings = null;
        }
        this.scheduler = this.createScheduler(ctx.project.getConfig().projectPath);
    }

    /**
     * Nothing that touches the backend, on purpose. Probing availability dlopens the
     * native library and a status scan takes Lore's exclusive repository lock - which
     * BLOCKS the author's own `lore` CLI rather than failing it. Both wait for someone
     * to open the UI.
     *
     * The checkpoint scheduler does start here, because it is not one of those things: a
     * write observer plus one heartbeat, and nothing reaches the host until a versioned
     * file has actually been written and the configured interval has passed.
     */
    public override activate(_ctx: WorkspaceContext): void {
        this.scheduler?.start();
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.scheduler?.stop();
        this.scheduler = null;
        this.settings = null;
        this.availability = null;
        this.status = null;
        this.history.clear();
        this.events.clear();
    }

    /**
     * The automatic-checkpoint timer for one project.
     *
     * Every decision it makes is delegated back here so the scheduler itself has no
     * knowledge of IPC, settings storage or the freeze latch - which is what makes its
     * four load-bearing behaviours (no fire without a change, none at interval 0, none
     * for a cache write, none while frozen) testable without a workspace.
     */
    private createScheduler(projectPath: string): CheckpointScheduler {
        return new CheckpointScheduler({
            intervalMinutes: () => Number(
                this.settings?.getSync(CHECKPOINT_INTERVAL_SETTING, CHECKPOINT_INTERVAL_DEFAULT_MINUTES)
                ?? CHECKPOINT_INTERVAL_DEFAULT_MINUTES,
            ),
            // The freeze gate's own predicate, reused rather than re-derived: it answers
            // "is this absolute path versioned data of this project", which is exactly
            // the question here, and it owns the Windows case-folding rule that a second
            // copy would get subtly wrong. One predicate means the set of paths that can
            // trigger a checkpoint is the set a freeze protects.
            counts: (absolutePath) => isFrozenProjectData(projectPath, absolutePath),
            isFrozen: () => getProjectWriteFreeze() !== null,
            checkpoint: () => this.createCheckpoint("interval"),
            observeWrites: (observer) => BaseFileSystemService.observeWrites(observer),
            onError: (error) => console.warn("[VersionControl] Automatic checkpoint failed", error),
        });
    }

    /**
     * Whether this host can do version control at all, and why not if it cannot.
     *
     * Ask this before showing any version control affordance. It is the supported way
     * to find out - probing with another call and catching the error cannot tell
     * "this machine has no backend" apart from "this directory is not a repository",
     * and those need opposite things said to the author.
     */
    public async getAvailability(): Promise<VcsAvailability> {
        if (!this.availability) {
            const pending: Promise<VcsAvailability> = getInterface().vcs.getAvailability().then(
                (result) => {
                    if (result.success) return result.data;
                    // The host could not even answer. That is still an answer about this
                    // installation rather than an exception to propagate, and it is the
                    // same thing a corrupt native library looks like from here.
                    return { available: false, reason: "backend-load-failed", detail: result.error };
                },
                (error: unknown) => {
                    // The CHANNEL failed, not the backend - `ipcRenderer.invoke` rejects
                    // when no handler is registered or the window is tearing down. Still
                    // answered rather than thrown, because every read below promises to
                    // degrade rather than throw and they all wait on this one.
                    //
                    // And not cached: a rejected promise kept here would make all of them
                    // throw for the rest of the session, turning a momentary channel
                    // problem into a permanently broken feature. A backend that will not
                    // load stays not-loaded; a channel can be fine a second later.
                    if (this.availability === pending) this.availability = null;
                    return {
                        available: false,
                        reason: "backend-load-failed",
                        detail: error instanceof Error ? error.message : String(error),
                    };
                },
            );
            this.availability = pending;
        }
        return this.availability;
    }

    /** True when the backend works AND this project directory is a repository. */
    public async isRepository(): Promise<boolean> {
        if (!(await this.isAvailable())) return false;
        const result = await getInterface().vcs.isRepository(this.projectPath());
        return result.success ? result.data.isRepository : false;
    }

    /**
     * Repository identity and head. Null when there is none to report - an
     * unsupported host and a directory that was never initialised both land here, and
     * {@link getAvailability} is what tells them apart.
     */
    public async getInfo(): Promise<VcsRepositoryInfo | null> {
        if (!(await this.isAvailable())) return null;
        const result = await getInterface().vcs.getInfo(this.projectPath());
        return result.success ? result.data : null;
    }

    /**
     * Revisions, newest first. `limit` 0 means all of them.
     *
     * Async and possibly slow: on a project with a remote the first read fetches
     * fragments over the network (docs §6). Show a loading state; there is
     * deliberately no synchronous accessor to fall back on.
     *
     * `includeDetails` asks what each revision says about itself: its kind, message,
     * timestamp and author. It is opt-in because the backend has no batch metadata verb,
     * so it costs one call PER REVISION - and it is part of the cache key rather than a
     * filter on one cached list, because a page read without details cannot answer a
     * later question about them.
     *
     * All four arrive on the SAME read and are deliberately NOT separate states of that
     * key: the main process reads them out of one metadata call, so there is no such
     * thing as a page that has the kind and lacks the message. Splitting the key per
     * field would double the cached pages and re-pay that per-revision cost for data
     * already in hand - which is what the flag's name has to say, and why it is not
     * called `includeKinds`.
     */
    public async getHistory(limit = 0, options: { includeDetails?: boolean } = {}): Promise<VcsHistoryEntry[]> {
        const includeDetails = options.includeDetails === true;
        const key = `${limit}:${includeDetails ? "details" : "plain"}`;
        const cached = this.history.get(key);
        if (cached) return cached;

        const pending = (async () => {
            if (!(await this.isAvailable())) return [];
            const result = await getInterface().vcs.getHistory(this.projectPath(), limit, includeDetails);
            return result.success ? result.data.entries : [];
        })();
        this.history.set(key, pending);
        // A failed read must not become the cached answer for the rest of the session.
        void pending.catch(() => this.history.delete(key));
        return pending;
    }

    /**
     * One file's bytes at one revision - the input to a diff.
     *
     * Throws rather than degrading. Every other read here has an honest empty answer;
     * this one does not, and returning zero bytes for "the backend is missing" would
     * render as a file whose contents were deleted at that revision.
     */
    public async readBlob(revision: RevisionId, path: string): Promise<Uint8Array> {
        const result = await getInterface().vcs.readBlob(this.projectPath(), revision, path);
        if (!result.success) throw vcsCallFailed(result);
        return decodeBase64(result.data.contentBase64);
    }

    /**
     * One file's bytes as the working tree holds them now - a comparison's other side.
     *
     * **Null means the file is too large to hand over**, which is a fact about the file rather
     * than a failure: the ceiling is in the main process (`vcs/diff/documentDiff.ts`), a project is
     * allowed to hold something past it, and a surface has to be able to say so. Everything else
     * throws, for {@link readBlob}'s reason - and a path outside the project or outside version
     * control throws loudly on purpose, because no comparison can name one.
     */
    public async readWorkingFile(path: string): Promise<Uint8Array | null> {
        const result = await getInterface().vcs.readWorkingFile(this.projectPath(), path);
        if (!result.success) throw vcsCallFailed(result);
        return result.data.contentBase64 === null ? null : decodeBase64(result.data.contentBase64);
    }

    /**
     * Every document at one revision, in one round trip. `null` means the revision does
     * not contain that path.
     *
     * The backing read for {@link showRevision}. Throws rather than degrading, for
     * {@link readBlob}'s reason: an empty answer here would render as a project whose
     * every document was deleted at that revision.
     */
    public async readRevisionDocuments(
        revision: RevisionId,
        paths?: readonly string[],
    ): Promise<Map<string, string | null>> {
        const result = await getInterface().vcs.readRevisionDocuments(
            this.projectPath(),
            revision,
            paths ? [...paths] : undefined,
        );
        if (!result.success) throw vcsCallFailed(result);
        const documents = new Map<string, string | null>();
        for (const entry of result.data.documents) {
            documents.set(entry.path, entry.contentBase64 === null ? null : decodeUtf8(entry.contentBase64));
        }
        return documents;
    }

    /**
     * Show a past revision in the real editors, and stay there until {@link showWorkingTree}.
     *
     * One call on purpose: the two halves - arming the freeze and re-reading from the revision - are
     * only safe in one order, and a caller that could do them separately could do them in the wrong
     * one. `WorkspaceFreezeService.showRevision` is where that ordering is written down; this method
     * is what makes the revision id enough to ask.
     *
     * Slow. The prewarm inside it reads the revision's documents in a single batch, and on a project
     * with a remote that batch goes to the network (docs/version-control.md §6). Await it and show
     * progress; there is deliberately no fire-and-forget form.
     */
    public async showRevision(revision: RevisionId, label?: string): Promise<void> {
        const availability = await this.getAvailability();
        if (!availability.available) {
            throw new Error(`Version control is not available on this machine (${availability.reason})`);
        }
        const source = new RevisionDocumentSource(revision, {
            readRevisionDocuments: (target, paths) => this.readRevisionDocuments(target, paths),
        });
        await this.freezeService().showRevision(source, label);
    }

    /**
     * Leave a revision view: the working tree is read back into the editors and project data becomes
     * writable again.
     *
     * A no-op when the workspace was not frozen, which is what makes it safe to call from a control
     * that does not know the current state.
     */
    public showWorkingTree(): void {
        this.freezeService().thaw();
    }

    /** The revision the editors are showing, or null when they are showing the working tree. */
    public getShownRevision(): RevisionId | null {
        const reason = this.freezeService().getReason();
        return reason?.kind === "revision" ? reason.revision : null;
    }

    /**
     * Put the working tree back to a past revision, then leave the version view and re-read.
     *
     * The write itself happens entirely in the main process - it reads a revision tree and rewrites
     * project files, neither of which the renderer can do - so this method owns only the two halves
     * around it: asking, and putting the workspace back into a state that matches the disk.
     *
     * **The freeze does not stop it, and it must not.** A revision view freezes project data at the
     * renderer's write boundary; the restore writes from main and never passes that latch. So the
     * ordering here is not about permission, it is about memory: once main has rewritten the files,
     * every document this window holds - including the historical ones a revision view deliberately
     * loaded - describes something that is no longer on disk, and the next save would put them back.
     * Leaving the revision view is what re-reads them (`thaw` drops the source, reloads from disk and
     * only then unfreezes, in that order). At HEAD there is no freeze to leave, so the same re-read
     * is asked for directly - the working tree changed under the editors either way, and that is the
     * whole reason `WorkspaceReloadService` exists.
     *
     * Throws rather than degrading, like {@link commit}: the author asked for this, and a restore
     * that quietly did not happen leaves them believing their project is a version it is not.
     */
    public async restoreRevision(revision: RevisionId, options: VcsRestoreOptions = {}): Promise<VcsRestoreResult> {
        const availability = await this.getAvailability();
        if (!availability.available) {
            throw new Error(`Version control is not available on this machine (${availability.reason})`);
        }
        const freeze = this.freezeService();
        // Held for the whole rewrite, and this is the half of the ordering above that a disabled
        // button cannot provide: main is rewriting the working tree file by file, so ANY other way
        // out of the revision view - the command palette, the switcher menu, a keybinding somebody
        // adds next month - would re-read a tree that is half one version and half another, and the
        // next save would put that hybrid on disk.
        const release = freeze.holdRelease();
        let result;
        try {
            result = await getInterface().vcs.restoreRevision(this.projectPath(), revision, options);
        } finally {
            // **Released before this method leaves the view itself, and the order is not optional.**
            // The hold does not know who owns it, so a restore still holding its own hold would
            // refuse its own `thaw` - and the author would sit in a history view, on a working tree
            // that is already the old version, with no way back that works.
            release();
        }
        if (!result.success) throw vcsCallFailed(result);
        // Before the re-read, because the head has moved and the surfaces that name it re-read it
        // themselves - and because everything cached here describes the tree as it was.
        this.afterRevision();

        if (freeze.isFrozen()) {
            freeze.thaw();
        } else {
            await this.getContext().services
                .get<WorkspaceReloadService>(Services.WorkspaceReload)
                .reload("restore");
        }
        return result.data;
    }

    private freezeService(): WorkspaceFreezeService {
        return this.getContext().services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
    }

    // -- remote ---------------------------------------------------------------

    /**
     * The server this project synchronises with, or null when it has none.
     *
     * A LOCAL read - it reads the repository's own config and opens no socket - so it is
     * safe to ask on opening the panel, which is the whole reason it is separate from
     * {@link getSyncState}. Answers null rather than throwing on an unavailable backend,
     * so a caller can use it as a plain "is there a server" check.
     */
    public async getRemote(): Promise<string | null> {
        if (!(await this.isAvailable())) return null;
        const result = await getInterface().vcs.getRemote(this.projectPath());
        return result.success ? result.data.url : null;
    }

    /**
     * Point this project at a server, or disconnect it with null.
     *
     * Throws on failure, because the author asked for it and a setting that silently did
     * not save is worse than one that reported why.
     *
     * **Does not contact the server**, deliberately: setting up and reaching are separate
     * acts, so this works with the network down and answers instantly. Whether anyone is
     * there is the next question, and it is the author's to ask.
     */
    public async setRemote(url: string | null): Promise<string | null> {
        const availability = await this.getAvailability();
        if (!availability.available) {
            throw new Error(`Version control is not available on this machine (${availability.reason})`);
        }
        const result = await getInterface().vcs.setRemote(this.projectPath(), url);
        if (!result.success) throw vcsCallFailed(result);
        return result.data.url;
    }

    /**
     * Where this branch stands against its server.
     *
     * **The one read on this service that waits on a network.** Measured at up to ~2s
     * when nothing answers, which is why it is never called on project open and never on
     * a timer - the same rule as `refreshStatus`, arrived at for a different reason
     * (latency rather than the scan's side effects). Call it when the author opens the
     * server section, presses refresh, or right after a push or sync.
     *
     * An unreachable server is `remoteAvailable: false`, not an error.
     */
    public async getSyncState(): Promise<VcsSyncState | null> {
        if (!(await this.isAvailable())) return null;
        const result = await getInterface().vcs.getSyncState(this.projectPath());
        return result.success ? result.data : null;
    }

    /**
     * Send this branch's revisions to the server.
     *
     * Throws on failure with the backend's own words, which for the failure that actually
     * happens - a diverged branch - already name the remedy. Nothing local changes, so a
     * failure leaves the project exactly as it was and the author can simply sync and
     * press again.
     */
    public async push(): Promise<VcsPushResult> {
        const availability = await this.getAvailability();
        if (!availability.available) {
            throw new Error(`Version control is not available on this machine (${availability.reason})`);
        }
        const result = await getInterface().vcs.push(this.projectPath());
        if (!result.success) throw vcsCallFailed(result);
        return result.data;
    }

    /**
     * Bring the server's revisions down, then re-read everything they made wrong.
     *
     * **This is a working-tree write, so it carries `restoreRevision`'s whole contract**
     * and for the same reason: main rewrites project files without passing the renderer's
     * write latch, so afterwards every document this window holds describes something
     * that is no longer on disk - and the next auto-save would put it back. The hold, the
     * `afterRevision`, and the thaw-or-reload below are therefore not optional, and the
     * ordering is the one `restoreRevision` documents.
     *
     * The hold matters more here than it looks: a sync can take a while on a real
     * project, and any other way out of a revision view during it - the palette, the
     * switcher, a keybinding - would re-read a tree that is half one version and half
     * another.
     *
     * A conflicted sync resolves SUCCESSFULLY carrying `conflicts`. That is not
     * squeamishness: by then the tree is written, so reporting a failure would tell the
     * author nothing happened while their files say otherwise. The caller shows the list
     * and says Studio cannot resolve them yet.
     */
    public async sync(): Promise<VcsSyncResult> {
        const availability = await this.getAvailability();
        if (!availability.available) {
            throw new Error(`Version control is not available on this machine (${availability.reason})`);
        }
        const freeze = this.freezeService();
        const release = freeze.holdRelease();
        let result;
        try {
            result = await getInterface().vcs.sync(this.projectPath());
        } finally {
            // Before leaving the view, exactly as in `restoreRevision`: a sync still
            // holding its own hold would refuse its own thaw.
            release();
        }
        if (!result.success) throw vcsCallFailed(result);

        // Nothing arrived, so nothing on screen is stale and there is no reason to make
        // every editor re-read. The head has not moved either.
        if (result.data.alreadyCurrent) return result.data;

        this.afterRevision();
        if (freeze.isFrozen()) {
            freeze.thaw();
        } else {
            await this.getContext().services
                .get<WorkspaceReloadService>(Services.WorkspaceReload)
                .reload("restore");
        }
        return result.data;
    }

    // -- merge ----------------------------------------------------------------

    /**
     * Whether this project is in the middle of a merge, and which paths it left to a human.
     *
     * **Ask on project open, not only after a sync.** A merge is repository state and outlives the
     * window: the author can close Studio on a conflicted sync and reopen it tomorrow, and nothing
     * in this window remembers. Null means this host has no version control, which is the one
     * answer a caller renders as "there is nothing to show".
     *
     * Cheap and local - a non-scanning status read plus a walk of the versioned working set - but
     * not free, so it is asked on open and after the operations that change it, never on a timer.
     *
     * **`conflicts` is "the merge left these to a human", not a to-do list**, and no caller may
     * present it as one: a path stays on it after the author settles it, because settling records
     * no mark anywhere Studio can read (see `VcsMergeState.conflicts`). A surface showing progress
     * keeps its own record for the life of the window.
     */
    public async getMergeState(): Promise<VcsMergeState | null> {
        if (!(await this.isAvailable())) return null;
        const result = await getInterface().vcs.getMergeState(this.projectPath());
        return result.success ? result.data : null;
    }

    /**
     * The three-way merge of ONE conflicted document, change by change - tier two.
     *
     * Asked per path and on demand rather than for the whole merge at once: a decision carries both
     * sides' values verbatim, so a merge with two hundred conflicted files would be a message
     * nobody reads most of.
     *
     * **A `blocked` answer is a normal one and the caller must draw it**, not hide the row: it says
     * this document has to be taken whole, and why. Null means this host has no version control.
     *
     * Records nothing, exactly like {@link getMergeState}: the repository cannot tell a settled
     * change from an unsettled one, so the choices taken on this live in the window that asked.
     */
    public async getMergeDocument(path: string): Promise<VcsMergeDocument | null> {
        if (!(await this.isAvailable())) return null;
        const result = await getInterface().vcs.getMergeDocument(this.projectPath(), path);
        if (!result.success) throw vcsCallFailed(result);
        return result.data;
    }

    /**
     * Take one side per conflicted path, record the result, and put the workspace back in step
     * with the disk.
     *
     * **The same contract as {@link restoreRevision} and {@link sync}, for the same reason**: the
     * main process rewrites project files without passing the renderer's write latch, so
     * afterwards every document this window holds describes something that is no longer on disk -
     * and the next auto-save would put it back. So the hold, the `afterRevision` and the
     * thaw-or-reload below are not optional, and the ORDER is not either: the hold is released
     * before this method leaves the view, because the hold does not know who owns it and a merge
     * still holding its own hold would refuse its own `thaw` - stranding the author in a frozen
     * view over a working tree that has already changed.
     *
     * Throws on failure with the backend's own words. The failure that actually happens is a path
     * nobody decided, and the backend's sentence names it - which is more useful than anything
     * this layer could substitute. Nothing is recorded in that case and the merge stays open, so
     * the author can decide the file and press again.
     *
     * **The re-read happens on the failure path too, and that is measured rather than cautious.**
     * A refused close is not a rollback: the sides chosen before the refusal are already written
     * over the author's files (`merge.integration.test.ts` asserts exactly that), so an editor
     * still holding the pre-merge bytes of one of them would write them back at the next auto-save.
     * The throw comes after, so the caller still sees the failure - it just sees it over a
     * workspace that matches the disk.
     */
    public async completeMerge(
        decisions: readonly VcsMergeDecision[],
        options: VcsCommitOptions = {},
    ): Promise<VcsMergeCompletion> {
        const availability = await this.getAvailability();
        if (!availability.available) {
            throw new Error(`Version control is not available on this machine (${availability.reason})`);
        }
        const freeze = this.freezeService();
        const release = freeze.holdRelease();
        let result;
        try {
            result = await getInterface().vcs.completeMerge(this.projectPath(), [...decisions], options);
        } finally {
            release();
        }

        // Only on success: a refusal recorded nothing, and announcing a revision that does not
        // exist is how the version surfaces drifted apart the last time.
        if (result.success) this.afterRevision();
        // Either way: settled or refused, what the merge is has changed.
        this.events.emit("mergeChanged", undefined);
        // **Before the re-read, and this ordering is load-bearing.** While the merge was open the
        // conflicted paths were read out of its `~mine` copies so the project could be opened at
        // all; the commit deletes those copies, so a reload with the substitution still installed
        // would ask for files that no longer exist and hand every service a default document - the
        // author's just-resolved work replaced by nothing, one save from being written.
        clearMergeConflictReads();
        if (freeze.isFrozen()) {
            freeze.thaw();
        } else {
            await this.getContext().services
                .get<WorkspaceReloadService>(Services.WorkspaceReload)
                .reload("restore");
        }

        if (!result.success) throw vcsCallFailed(result);
        return result.data;
    }

    /**
     * Abandon the merge and put the working tree back to what it was before it started.
     *
     * **A complete rollback, measured rather than assumed** (docs §4.27) - which is the only
     * reason this is offered at all: a cancel that left a half-merged tree behind would be worse
     * than no cancel.
     *
     * It writes the author's files without adding a revision, so it carries the working-tree half
     * of {@link completeMerge}'s contract - hold, release, re-read - and not the revision half.
     */
    public async abortMerge(): Promise<VcsMergeState> {
        const availability = await this.getAvailability();
        if (!availability.available) {
            throw new Error(`Version control is not available on this machine (${availability.reason})`);
        }
        const freeze = this.freezeService();
        const release = freeze.holdRelease();
        let result;
        try {
            result = await getInterface().vcs.abortMerge(this.projectPath());
        } finally {
            release();
        }
        if (!result.success) throw vcsCallFailed(result);

        // No revision was recorded, so the head has not moved - but every document under the
        // editors was just rewritten, which is the half that still has to be undone in memory.
        this.events.emit("mergeChanged", undefined);
        // Before the re-read, for the reason `completeMerge` gives: abandoning removes the merge's
        // copies too (measured, docs §4.27), so the substitution has to go with them.
        clearMergeConflictReads();
        if (freeze.isFrozen()) {
            freeze.thaw();
        } else {
            await this.getContext().services
                .get<WorkspaceReloadService>(Services.WorkspaceReload)
                .reload("restore");
        }
        return result.data;
    }

    /** Paths that differ between two revisions - the filter before diffing. */
    public async getChangedPaths(from: RevisionId, to: RevisionId): Promise<string[]> {
        if (!(await this.isAvailable())) return [];
        const result = await getInterface().vcs.getChangedPaths(this.projectPath(), from, to);
        return result.success ? result.data.paths : [];
    }

    /**
     * What changed between two revisions, as changes rather than as bytes.
     *
     * Null means this host has no version control, which is the one answer a caller can render as
     * "nothing to show here". Everything else throws, for {@link readBlob}'s reason: an empty change
     * list is what "nothing changed" looks like, and handing one back for a failed read would tell
     * the author two versions are identical when nobody managed to compare them.
     *
     * **Not cached here, and deliberately.** The main process caches this pair (revisions are
     * immutable, so the answer cannot go stale) and a second cache in the renderer would only add a
     * copy that survives a project switch. Its sibling below must never be cached anywhere.
     */
    public async diffRevisions(from: RevisionId, to: RevisionId): Promise<VcsRevisionDiffResult | null> {
        if (!(await this.isAvailable())) return null;
        const result = await getInterface().vcs.diffRevisions(this.projectPath(), from, to);
        if (!result.success) throw vcsCallFailed(result);
        return result.data;
    }

    /**
     * What the author has changed since the last version, as changes rather than as bytes.
     *
     * **Never cache this and never poll it**, which is the same rule {@link refreshStatus} carries
     * and for both of its reasons: the working tree has already moved on by the time this resolves,
     * and the status read underneath it SCANS - a scan that finds a new directory records it into
     * staged state, so a poll manufactures deletions of directories that never existed (docs §4.17).
     * It runs when a person asks to see what changed, and at no other time.
     */
    public async diffWorkingTree(): Promise<VcsWorkingTreeDiffResult | null> {
        if (!(await this.isAvailable())) return null;
        const result = await getInterface().vcs.diffWorkingTree(this.projectPath());
        if (!result.success) throw vcsCallFailed(result);
        return result.data;
    }

    /**
     * Put this project under version control.
     *
     * Throws on failure, and the message is meant to reach the author: this runs
     * because they asked for it, and the failures it has - already a repository, an
     * interrupted earlier setup that left an empty one - are things only they can
     * resolve. Silently reporting success would leave them believing their work is
     * protected when nothing is recording it.
     */
    public async initRepository(options: VcsInitOptions = {}): Promise<VcsRepositoryInfo> {
        const availability = await this.getAvailability();
        if (!availability.available) {
            throw new Error(`Version control is not available on this machine (${availability.reason})`);
        }
        const result = await getInterface().vcs.initRepository(this.projectPath(), options);
        if (!result.success) throw vcsCallFailed(result);
        // The project just became a repository: anything cached from before described
        // a project that did not have one.
        this.afterRevision();
        return result.data;
    }

    /**
     * Record the working tree as a new revision.
     *
     * Throws on failure, and the message is meant to reach the author - the same
     * contract as {@link initRepository}, for the same reason: they asked for this, and a
     * commit that quietly did not happen leaves them believing their work is recorded.
     * "Nothing has changed since the last revision" arrives here as a failure too,
     * because for someone who pressed Commit that IS the answer.
     *
     * Slow by nature. The main process settles this window's auto-save debt first, then
     * stages the whole project, commits, and waits for the backend to put its stores on
     * disk - skipping that last wait is measured to lose commits outright. Show progress
     * and await the result.
     */
    public async commit(options: VcsCommitOptions = {}): Promise<VcsCommitResult> {
        const availability = await this.getAvailability();
        if (!availability.available) {
            throw new Error(`Version control is not available on this machine (${availability.reason})`);
        }
        const result = await getInterface().vcs.commit(this.projectPath(), options);
        if (!result.success) throw vcsCallFailed(result);
        this.afterRevision();
        return result.data;
    }

    /**
     * Record a checkpoint: the same revision, labelled as one Studio took rather than
     * one the author asked for.
     *
     * Null means there was nothing to record - no repository, no backend, or a tree that
     * has not changed. That is deliberately not an error: this runs on a timer and before
     * a build, and "no revision needed" is the common case. Genuine failures still throw,
     * so the interval scheduler can report them once instead of every interval.
     */
    public async createCheckpoint(reason: VcsCheckpointReason): Promise<VcsCommitResult | null> {
        if (!(await this.isAvailable())) return null;
        const result = await getInterface().vcs.checkpoint(this.projectPath(), reason);
        if (!result.success) throw vcsCallFailed(result);
        if (result.data.revision) this.afterRevision();
        return result.data.revision;
    }

    /**
     * Everything cached that a new revision made wrong.
     *
     * The status snapshot described a tree with uncommitted changes in it, and every
     * cached history page is now one entry short. Deliberately does NOT scan to replace
     * the snapshot: a scan is not a pure read (see the class comment), so what to do next
     * is the caller's decision, not this method's.
     *
     * The event is what stops the version surfaces from drifting apart - they each read the
     * head themselves and none of them can see a revision another one caused.
     */
    private afterRevision(): void {
        this.history.clear();
        this.setStatus(null);
        this.events.emit("revisionRecorded", undefined);
    }

    /**
     * Whether an automatic checkpoint would currently record anything.
     *
     * Reads the write signal the scheduler already keeps, so asking is free - notably it
     * does not scan. False also means "no scheduler", which is the case before the
     * workspace is activated.
     */
    public hasUnrecordedChanges(): boolean {
        return this.scheduler?.hasUnrecordedChanges() ?? false;
    }

    /**
     * Scan the working tree and update the cached snapshot.
     *
     * The ONLY thing that scans. Call it when the author opens the changes view, asks
     * to refresh, or completes an operation that changed the tree - and from nothing
     * that fires on its own. Re-read the class comment before wiring this to anything
     * automatic.
     */
    public async refreshStatus(): Promise<VcsStatus | null> {
        if (!(await this.isAvailable())) {
            this.setStatus(null);
            return null;
        }
        const result = await getInterface().vcs.getStatus(this.projectPath());
        this.setStatus(result.success ? result.data : null);
        return this.status;
    }

    /**
     * The last scan's snapshot, without scanning. Null when nothing has scanned yet,
     * which is not the same as "clean" - `VcsStatus.clean` is that.
     */
    public getStatus(): VcsStatus | null {
        return this.status;
    }

    /**
     * The snapshot's changes with directory entries dropped, which is what a change
     * list shown to an author usually wants.
     *
     * `counts` is deliberately NOT filtered to match. The backend counts directories
     * in its own summary - creating one folder with one file in it is two entries -
     * and re-deriving the numbers from this list would produce a second opinion that
     * disagrees with the repository. A view that shows both has to say what each one
     * is counting.
     *
     * Every `path` here is REPOSITORY-RELATIVE. That is the right shape for
     * {@link readBlob} and for the shared `isVersioned` predicate, and the OPPOSITE of
     * what the write verbs will want - Lore resolves a relative path against the
     * process working directory and then silently ignores it for being outside the
     * repository (docs §4.16). This service exposes no helper that turns a change into
     * a path for a write call; whichever milestone adds one has to make it absolute.
     */
    public getChangedFiles(): VcsFileChange[] {
        return this.status?.files.filter((file) => !file.directory) ?? [];
    }

    /**
     * Forget cached history. For the milestone that lands commits: a new revision
     * makes every cached page short by one, and nothing else can notice.
     */
    public invalidateHistory(): void {
        this.history.clear();
    }

    public onStatusChanged(handler: (status: VcsStatus | null) => void): () => void {
        return this.events.on("statusChanged", handler);
    }

    /**
     * A revision was recorded - by a commit, a checkpoint, or the repository being created.
     *
     * Subscribe from anything that displays which version this project is on. Re-reading the head
     * here is cheap and does not scan: one `isRepository` round trip and one `getInfo`, which is a
     * `scan: false, revisionOnly: true` status read in the main process.
     */
    public onRevisionRecorded(handler: () => void): () => void {
        return this.events.on("revisionRecorded", handler);
    }

    /**
     * A merge was closed or abandoned. Subscribe from anything that offers the way into resolving
     * one; re-read {@link getMergeState} rather than assuming what changed.
     *
     * A sync that CREATES a merge does not fire this: the caller of `sync` already has the result
     * in hand and re-reads on its own.
     */
    public onMergeChanged(handler: () => void): () => void {
        return this.events.on("mergeChanged", handler);
    }

    private async isAvailable(): Promise<boolean> {
        return (await this.getAvailability()).available;
    }

    /** This window's project. Every VCS call is scoped to it, never to "some project". */
    private projectPath(): string {
        return this.getContext().project.getConfig().projectPath;
    }

    private setStatus(next: VcsStatus | null): void {
        this.status = next;
        this.events.emit("statusChanged", next);
    }
}

/**
 * Blobs cross IPC as base64 - a Buffer would arrive as a Uint8Array anyway, and the
 * encoding keeps the contract explicit. Byte-wise on purpose: these are binary assets
 * as often as they are text, and any string round trip would corrupt them.
 */
function decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * A document's text out of the base64 the channel carries.
 *
 * Lenient rather than `fatal: true`: a versioned file that is not valid UTF-8 has to reach the
 * document layer and be reported as unreadable there, the same way a corrupt working-tree file is.
 * Throwing here instead would take down the whole batch - one bad blob, and the author sees an
 * unexplained failure rather than one document that could not be read.
 */
function decodeUtf8(base64: string): string {
    return new TextDecoder("utf-8").decode(decodeBase64(base64));
}
