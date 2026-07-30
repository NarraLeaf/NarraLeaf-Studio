import { getInterface } from "@/lib/app/bridge";
import { getProjectWriteFreeze, isFrozenProjectData } from "@/lib/app/writeFreeze";
import type {
    RevisionId,
    VcsAvailability,
    VcsCheckpointReason,
    VcsCommitOptions,
    VcsCommitResult,
    VcsFileChange,
    VcsHistoryEntry,
    VcsInitOptions,
    VcsRepositoryInfo,
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
 * same §4.17 reason the paragraph above gives. Restore, branch and push are still to
 * come and are deliberately not stubbed: a method that resolves without doing anything
 * is worse than one that does not exist.
 */

type VersionControlServiceEvents = {
    /** Null once the cached snapshot is dropped, e.g. on teardown or after init. */
    statusChanged: VcsStatus | null;
    /**
     * A revision now exists that did not before, so HEAD has moved.
     *
     * Every surface that names a version reads the head for itself - the rail, the top-bar widget
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
     * shapes the whole feature (docs/plans/2026-07-28-002 §1).
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
        if (!result.success) throw new Error(result.error);
        return decodeBase64(result.data.contentBase64);
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
        if (!result.success) throw new Error(result.error);
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

    private freezeService(): WorkspaceFreezeService {
        return this.getContext().services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
    }

    /** Paths that differ between two revisions - the filter before diffing. */
    public async getChangedPaths(from: RevisionId, to: RevisionId): Promise<string[]> {
        if (!(await this.isAvailable())) return [];
        const result = await getInterface().vcs.getChangedPaths(this.projectPath(), from, to);
        return result.success ? result.data.paths : [];
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
        if (!result.success) throw new Error(result.error);
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
        if (!result.success) throw new Error(result.error);
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
        if (!result.success) throw new Error(result.error);
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
