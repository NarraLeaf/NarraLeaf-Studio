import path from "path";
import type {
    VcsAvailability,
    VcsBlobRequest,
    VcsCheckpointReason,
    VcsCommitOptions,
    VcsCommitResult,
    VcsHistoryEntry,
    VcsRepositoryInfo,
    VcsRestoreOptions,
    VcsRestoreResult,
    VcsRevisionKind,
    VcsStatus,
    VcsThreeWayResult,
} from "@shared/types/vcs";
import { BaseApp } from "../../baseApp";
import { Manager } from "../manager";
import { getVcsAvailability, requireVcsBackend, type VcsBackend } from "./backend";
// Type-only: erased at compile time, so no Lore module is reachable from here
// at load time. See backend.ts for why that matters.
import type { LoreGlobals, LoreHex, StoreHandle } from "./lore";
import type { InitRepositoryOptions } from "./repository";
// Value import, and safe to be one: this module only touches `fs` and the working-set predicate,
// and imports the reader for types alone.
import { materializeRevisionSnapshot, type RevisionSnapshotResult } from "./revisionSnapshot";
// Same argument: policy plus `fs`, with the reader imported for types alone.
import { applyRevisionRestore, planRevisionRestore, readWorkingSetPaths } from "./revisionRestore";

/**
 * Owns Lore state for open projects.
 *
 * Two invariants shape this class:
 *
 * 1. **Optional backend.** Version control is a capability Studio may not have
 *    on a given host (no macOS Intel or Windows ARM64 native build). Nothing
 *    here imports the backend at module scope; it is loaded on demand through
 *    `backend.ts` and every entry point degrades instead of crashing.
 *
 * 2. **Keyed per project, never a singleton.** Studio is one-project-one-window
 *    and a singleton runtime silently makes the second open project fight the
 *    first (the mistake DevModeManager shipped and had to undo). Compounding it,
 *    Lore's repository lock is exclusive and *blocking* - a singleton would not
 *    race, it would deadlock. Every entry point takes a projectPath.
 *
 * Store handles are opened lazily and reused: reopening per call defeats the
 * local fragment cache the diff path depends on.
 */

/** What one revision says about itself, as the backend answers it. */
type RevisionDetails = Awaited<ReturnType<VcsBackend["readRevisionDetails"]>>;

interface VcsSession {
    /** Repository root on disk. For now this is the project directory itself. */
    root: string;
    store: StoreHandle;
    /** Repository (partition) id, hex. Learned on first use. */
    repositoryId: LoreHex;
    globals: LoreGlobals;
    /**
     * What each revision already said about itself, remembered for the life of the session.
     *
     * Revisions are IMMUTABLE, so this cannot go stale - and it is what makes the rail's paging
     * affordable. There is no cursor verb in the backend (`readRevisionGraph(globals, limit)` is
     * the whole history surface), so "show older versions" re-reads with a larger limit: the fifth
     * press asks for 250 revisions to gain 50 new ones. Details cost ONE CALL PER REVISION taken in
     * turn (see {@link VcsManager.getHistory}), so without this that press pays 250 of them.
     *
     * **Details only, never the graph.** A new commit changes the graph and cannot change what an
     * existing revision already recorded, which is exactly the line between what may be cached here
     * and what may not.
     *
     * Bounded by how far the author actually paged, and dropped with the session in
     * {@link VcsManager.closeProject}.
     */
    details: Map<LoreHex, RevisionDetails>;
}

/**
 * Have one project's window write out every auto-save it still owes, and wait.
 *
 * Injected rather than reached for, because only the window layer can do it and this
 * manager deliberately holds a `BaseApp`. A commit with this missing would still work
 * and would still be wrong: the revision would describe a document that is about to
 * change, which is the one failure the pipeline's ordering exists to prevent.
 *
 * Must not throw. A workspace that cannot flush is a reason to log, not a reason to
 * refuse the author their commit.
 */
export type PendingSaveFlush = (projectPath: string) => Promise<void>;

/**
 * What a checkpoint's message says, by why it was taken.
 *
 * Not translated, deliberately. A commit message is permanent repository content that
 * travels to collaborators and outlives the interface language it was written under; a
 * history where the same automatic checkpoint reads differently depending on who was
 * looking when it happened is worse than one that reads in English throughout.
 *
 * Same argument for the restore message built in {@link VcsManager.restoreRevision}.
 */
const CHECKPOINT_MESSAGES: Readonly<Record<VcsCheckpointReason, string>> = {
    interval: "Checkpoint",
    "project-close": "Checkpoint before closing the project",
    build: "Checkpoint before build",
    restore: "Checkpoint before restore",
};

const DEFAULT_COMMIT_MESSAGE = "Commit";

/** How much of a revision id names it in a commit message when the caller had no label. */
const RESTORE_MESSAGE_HASH_LENGTH = 12;

/**
 * Size ceiling on one document read out of a revision, when the caller did not name the
 * paths it wants.
 *
 * Generous on purpose - a story document with a few thousand blocks is well under it -
 * and it exists only to keep a mis-selected asset out of the batch. Anything genuinely
 * larger has to be asked for by path.
 */
const DEFAULT_REVISION_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * What a project with no configured author name records.
 *
 * Deliberately not the OS account name. The identity is written into revisions that
 * outlive the machine and travel to collaborators once there is a remote, and quietly
 * publishing the author's login as their name is not a decision Studio gets to make on
 * their behalf. Naming the tool is honest about what is known: nobody said.
 */
export const UNCONFIGURED_IDENTITY = "NarraLeaf Studio";

/**
 * "Nothing changed" told apart from a genuine failure.
 *
 * By name rather than with `instanceof`: the class lives in `repository.ts`, which
 * nothing above `backend.ts` may reach at module scope, and re-loading the backend
 * inside a catch block to get at the constructor could replace the error being handled
 * with a load failure.
 */
function isNothingToCommit(error: unknown): boolean {
    return error instanceof Error && error.name === "NothingToCommitError";
}

/**
 * The one spelling of a project path this manager keys on.
 *
 * **Two spellings of one directory used to be two projects here**, and the consequence was not a
 * duplicated cache - it was a process deadlocking against itself. The session map and the operation
 * queue were keyed on the caller's string with only trailing separators removed, so
 * `D:/projects/demo` and `D:\projects\demo` produced two entries; the second opened a SECOND store
 * on the same repository, and Lore's repository lock is exclusive and BLOCKING (§4.12). The second
 * open never returns, nothing reports an error, the process sits at zero CPU, and every later call
 * on that project queues behind it forever. Measured in a running Studio: the panel stayed on
 * "Submitting this version" while an unqueued call answered in 0ms.
 *
 * The two spellings are not hypothetical. Window-close paths take the path from the window's props
 * while the renderer sends the one out of the project config, and nothing has ever required those
 * to agree on a separator.
 *
 * `path.resolve` unifies separators and makes the path absolute, which the backend requires anyway
 * (§4.4 - relative paths resolve against the process working directory, which is never the
 * project). Case is folded on Windows only, where the filesystem is case-insensitive and
 * `D:\Demo` and `D:\demo` are one directory holding one lock.
 */
function projectKey(projectPath: string): string {
    const resolved = path.resolve(projectPath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * How long a store may take to open before the log says something.
 *
 * Not a timeout: waiting is the CORRECT behaviour when another process holds the repository, and
 * the wait ends the moment that process lets go (measured at 16 seconds in one case, §4.12).
 * Failing instead would turn a recoverable wait into a refusal. But a wait with nothing said is how
 * this presents to an author - a spinner that never stops - so the wait announces itself.
 */
const SLOW_STORE_OPEN_MS = 5_000;

export class VcsManager extends Manager {
    private readonly sessions = new Map<string, VcsSession>();
    /** Serializes work per project so two callers cannot interleave on one store. */
    private readonly operations = new Map<string, Promise<unknown>>();
    /**
     * Opens in flight, so concurrent first callers share one store rather than each opening their
     * own. See {@link sessionFor} for what the second store costs.
     */
    private readonly opening = new Map<string, Promise<VcsSession>>();

    constructor(app: BaseApp, private readonly flushPendingSaves?: PendingSaveFlush) {
        super(app);
    }

    public async initialize(): Promise<void> {
        // Nothing eager. Probing availability would load a 29MB native library on
        // every launch for a feature many projects never touch, and opening a
        // store takes Lore's exclusive repository lock. Both wait for first use.
    }

    /** Whether this host can run version control at all, and why not if it cannot. */
    public async getAvailability(): Promise<VcsAvailability> {
        return getVcsAvailability();
    }

    /**
     * Run `task` with exclusive access to one project's Lore session.
     * Mirrors the operations-map pattern the other per-project managers use.
     */
    private async serialize<T>(projectPath: string, task: () => Promise<T>): Promise<T> {
        const key = projectKey(projectPath);
        const previous = this.operations.get(key) ?? Promise.resolve();
        const tracked = previous.catch(() => undefined).then(task);
        // Keep the chain alive on failure; an error must not wedge the project.
        const guarded = tracked.catch(() => undefined);
        this.operations.set(key, guarded);
        void guarded.finally(() => {
            if (this.operations.get(key) === guarded) {
                this.operations.delete(key);
            }
        });
        return tracked;
    }

    /**
     * Open a store, and say so in the log if it is taking long enough to be a lock wait.
     *
     * See {@link SLOW_STORE_OPEN_MS} for why this warns rather than gives up. The message names the
     * only thing that can cause it - something else holding the repository - because an author whose
     * `lore` CLI is open in a terminal has an action available and no other way to learn of it.
     */
    private async openStoreAnnouncingDelay(
        backend: VcsBackend,
        globals: LoreGlobals,
        root: string,
    ): Promise<StoreHandle> {
        const slow = setTimeout(() => {
            this.app.logger.warn(
                "[Vcs] Still waiting to open", root,
                "- another process is holding this repository. Lore's lock is exclusive and blocks"
                + " rather than failing, so this call resumes as soon as that process lets go.",
            );
        }, SLOW_STORE_OPEN_MS);
        try {
            return await backend.openStore(globals, root);
        } finally {
            clearTimeout(slow);
        }
    }

    private globalsFor(root: string): LoreGlobals {
        return {
            repositoryPath: root,
            offline: true,
            // Retain fragments fetched from a remote. Off upstream by default, which
            // would make repeated diffs of the same two revisions re-fetch every time.
            cache: true,
            storeKeepAlive: true,
            /**
             * One second, not the ten-second default, and this number is the difference
             * between a commit that feels instant and one that appears to hang.
             *
             * MEASURED: `repositoryFlush` waits out the remaining keep-alive window of the
             * last call that kept the store alive. On the default the commit pipeline took
             * 10,012 ms of which the flush was 9,996; with this set to 1 it is 1,009 ms of
             * which the flush is 988; with keep-alive off entirely it is 29 ms. Staging and
             * committing themselves are 5-20 ms in every configuration, so the entire cost
             * is the wait.
             *
             * Also measured, because it is the obvious wrong fix: passing
             * `storeKeepAlive: false` on the pipeline's own calls changes NOTHING (1,029 ms
             * with it, 1,009 without). The wait belongs to the reads that came before, so
             * only the window length can shorten it.
             *
             * Kept rather than removed because reopening the store per call is what it
             * avoids for a burst of blob reads when a diff view opens, and one second is
             * far longer than the gap inside such a burst. If a future measurement shows
             * reopening is free, this whole flag can go and commits get the other second
             * back.
             */
            storeKeepAliveSeconds: 1,
        };
    }

    /**
     * The session for one project, opening it the first time it is asked for.
     *
     * **At most one open per project is ever in flight, and that is load-bearing.** Recording the
     * session takes two awaits - the store, then the identity read - and a second caller arriving
     * inside that window used to miss the map and open a store of its own. Only the last one
     * reached `sessions.set`; the earlier handles were unreachable, so `closeProject` could not
     * release them and Lore held the repository - exclusively - for the rest of the process's life.
     * Measured in a running Studio: opening a versioned project logged four "Opened session" lines
     * and closing it logged one.
     *
     * What that costs is not a stale cache. Reopening the same project then blocks on the lock
     * Lore never gave back (it blocks rather than failing, §4.12), and because every Lore call is a
     * koffi `async` call it blocks on a **libuv thread pool** thread. Four of them is the whole
     * default pool, and `fs` runs on that same pool - so the second open of a project stopped the
     * main process reading ANY file: no assets, no stories, no dashboard, and a window that could
     * not be closed because the close path waits for a checkpoint.
     *
     * So callers that arrive during an open join it instead of starting another.
     */
    private async sessionFor(projectPath: string): Promise<{ session: VcsSession; backend: VcsBackend }> {
        const backend = await requireVcsBackend();
        const key = projectKey(projectPath);
        const existing = this.sessions.get(key);
        if (existing) return { session: existing, backend };

        const opening = this.opening.get(key) ?? this.openSession(projectPath, key, backend);
        return { session: await opening, backend };
    }

    /**
     * Open one store and record it, exactly once per project.
     *
     * Registered in {@link opening} before it can yield - the body runs synchronously up to its
     * first await, and nothing else can interleave in between - so a caller arriving a tick later
     * finds the promise rather than an empty map.
     */
    private openSession(projectPath: string, key: string, backend: VcsBackend): Promise<VcsSession> {
        const pending = (async (): Promise<VcsSession> => {
            // The resolved path rather than the key: the key is case-folded for lookup and this is
            // what is handed to the backend and used to build absolute paths off.
            const root = path.resolve(projectPath);
            const globals = this.globalsFor(root);
            const store = await this.openStoreAnnouncingDelay(backend, globals, root);

            let repositoryId: LoreHex;
            try {
                // The repository id comes off the revision-history header, a purely
                // local read. Deliberately not `repositoryInfo`: that verb dials the
                // remote even under `offline: true` and blocks until the socket times out.
                const identity = await backend.readRepositoryIdentity(globals);
                if (!identity?.repository) {
                    throw new Error(
                        "Repository has no revisions yet; version control is unavailable until the first commit",
                    );
                }
                repositoryId = identity.repository;
            } catch (error) {
                // Do not leak the handle (or the exclusive lock) if identity lookup fails.
                // Closing the store is not enough on its own: Lore keeps the repository
                // itself open afterwards, and while it does, the directory cannot be
                // deleted and the author's `lore` CLI blocks on the lock instead of
                // failing. This path runs on every `isRepository` check against a
                // directory that turns out not to be one, so it is not a rare corner.
                await backend.closeStore(globals, store).catch(() => undefined);
                await backend.releaseRepository(globals).catch(() => undefined);
                throw error;
            }

            const session: VcsSession = { root, store, repositoryId, globals, details: new Map() };
            this.sessions.set(key, session);
            this.app.logger.info("[Vcs] Opened session", root, repositoryId);
            return session;
        })();

        this.opening.set(key, pending);
        void pending.catch(() => undefined).finally(() => {
            // A failed open must not become the cached answer: the next caller has to try again
            // (a directory that is not a repository is asked about on every `isRepository`).
            if (this.opening.get(key) === pending) this.opening.delete(key);
        });
        return pending;
    }

    /**
     * True when this host has a working backend AND the directory is a Lore
     * repository. Returns false rather than throwing on an unsupported host, so
     * a caller can use it as a plain feature check.
     *
     * Queued like every other verb, and not because it touches the store: it is the ONE question
     * three separate surfaces ask the moment a workspace opens (the rail, the switcher menu and the
     * status-bar cell each read the head for themselves, by design), so an unqueued one ran
     * alongside whatever else those surfaces started - which is how the open race in
     * {@link sessionFor} became the normal case rather than a corner. The queue is also what makes
     * {@link closeProject} able to see a session this call is about to record.
     */
    public async isRepository(projectPath: string): Promise<boolean> {
        try {
            await this.serialize(projectPath, () => this.sessionFor(projectPath));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Put a project under version control, creating the repository and its first
     * commit. Fails if the directory already has one.
     *
     * Never called on Studio's behalf. Creating a repository writes `.lore/` into the
     * author's project and takes an exclusive lock on it, so it is theirs to decide.
     *
     * Ordering matters and runs against the grain of the rest of this class: every
     * other entry point starts from {@link sessionFor}, which cannot exist yet - it
     * reads the repository id off the revision history, and there is no history until
     * this method makes one. So init works on bare globals and takes no session.
     */
    public async initRepository(
        projectPath: string,
        options: InitRepositoryOptions = {},
    ): Promise<VcsRepositoryInfo> {
        return this.serialize(projectPath, async () => {
            const backend = await requireVcsBackend();
            const root = path.resolve(projectPath);
            const globals = this.globalsFor(root);
            // Decided before the attempt, because the cleanup below must not run when
            // the answer is "it was already one": that path can have a LIVE SESSION on
            // the same directory, and releasing the repository out from under it would
            // leave an open store handle pointing at nothing.
            const preexisting = backend.isRepositoryDirectory(root);
            try {
                // Through the same resolver as every other write: the first commit's
                // author must not be the one revision in the repository attributed
                // differently from the rest.
                const created = await backend.initRepository(globals, {
                    ...options,
                    identity: this.resolveIdentity(options.identity),
                });
                this.app.logger.info("[Vcs] Initialised repository", root, created.repositoryId);
                return {
                    root,
                    repositoryId: created.repositoryId,
                    head: created.revision,
                    // Exactly the commit just made; nothing else can have happened yet.
                    headNumber: 1,
                    // Asked rather than assumed - the default branch is the backend's decision, not
                    // ours - but NOT allowed to fail the enable. The repository at this point is
                    // created, committed and flushed; refusing to report success because a cosmetic
                    // read came back empty would send the author to try again and be told they are
                    // already versioned. "" is the same "not reported" every other producer of this
                    // field uses, and the renderer re-reads the identity through `getInfo` the
                    // moment this resolves anyway.
                    branch: await backend.readBranchIdentity(globals)
                        .then((identity) => identity.branch)
                        .catch(() => ""),
                };
            } finally {
                // No session was opened here, so nothing else in this class will ever
                // let go of the repository - and Lore holds it open after the last
                // call. Left held, the project directory cannot be moved or deleted
                // and the author's own `lore` CLI blocks on the lock without an error.
                // In the `finally` because a half-created repository holds it too.
                if (!preexisting) {
                    await backend.releaseRepository(globals).catch((error) => {
                        this.app.logger.warn("[Vcs] Failed to release the repository after init", root, error);
                    });
                }
            }
        });
    }

    /**
     * Who to record as the author.
     *
     * Lore's `identity` is a per-call global rather than repository configuration, so
     * every write has to answer this. Three sources, in order, and the first is the
     * seam a logged-in identity plugs into without touching anything else here.
     */
    private resolveIdentity(explicit?: string): string {
        const configured = this.app.getGlobalState().get("versionControl.authorName");
        return explicit?.trim()
            || (typeof configured === "string" ? configured.trim() : "")
            || UNCONFIGURED_IDENTITY;
    }

    /**
     * Record the working tree as a new revision.
     *
     * The pipeline, in the one order that does not lose data:
     *
     * ```
     * flush the renderer's pending saves -> stage -> label -> commit -> flush Lore
     * ```
     *
     * The label sits before the commit, not after, and that is measured rather than
     * stylistic - see `commitWorkingTree`.
     *
     * **The renderer flush comes first** and is the step that is easy to leave out.
     * Studio's auto-save is debounced, so at any instant there is usually an edit that
     * has been typed and not written. Staging before it lands produces a revision that
     * describes a document already superseded on disk - and the author has no way to
     * see that, because the file they are looking at is right and only the history is
     * wrong. It runs inside the per-project serialization so nothing can stage between
     * the flush and the commit.
     *
     * **Lore's flush comes last, and before success is reported.** Not politeness: see
     * `commitWorkingTree`.
     *
     * Throws {@link NothingToCommitError} when the tree has not changed, which for an
     * author who pressed Commit is the answer rather than an error - the message says
     * so in words they can read, instead of Lore's "Nothing staged for commit".
     */
    public async commit(projectPath: string, options: VcsCommitOptions = {}): Promise<VcsCommitResult> {
        return this.commitWithKind(projectPath, "commit", options.message?.trim() || DEFAULT_COMMIT_MESSAGE, options);
    }

    /**
     * Record a checkpoint: an ordinary revision that the author did not ask for.
     *
     * Answers null rather than throwing for the two cases an automatic operation must
     * treat as normal - the project is not under version control (or this host has no
     * backend), and nothing has changed since the last revision. An empty revision
     * every fifteen minutes would make the history unreadable and "restore to before
     * lunch" unanswerable, so "nothing changed, no revision" holds for the timer and for
     * all three unconditional checkpoints alike.
     *
     * Real failures still throw. A checkpoint that could not be written because the
     * disk is full is not the same as one that was not needed.
     */
    public async checkpoint(
        projectPath: string,
        reason: VcsCheckpointReason,
        options: VcsCommitOptions = {},
    ): Promise<VcsCommitResult | null> {
        // Cheaper than it looks - the session is opened once per project and reused by
        // everything else - and it is what keeps an unversioned project silent rather
        // than logging a failure every interval for the rest of the session.
        if (!(await this.isRepository(projectPath))) return null;

        const message = options.message?.trim() || CHECKPOINT_MESSAGES[reason];
        try {
            const result = await this.commitWithKind(projectPath, "checkpoint", message, options);
            this.app.logger.info("[Vcs] Checkpoint", reason, result.revision);
            return result;
        } catch (error) {
            if (isNothingToCommit(error)) return null;
            throw error;
        }
    }

    private async commitWithKind(
        projectPath: string,
        kind: VcsRevisionKind,
        message: string,
        options: VcsCommitOptions,
    ): Promise<VcsCommitResult> {
        return this.serialize(projectPath, async () => {
            // First, and inside the lock. See the ordering note on `commit`.
            if (this.flushPendingSaves) {
                await this.flushPendingSaves(projectPath).catch((error) => {
                    this.app.logger.warn("[Vcs] Could not flush pending saves before committing", error);
                });
            }

            const { session, backend } = await this.sessionFor(projectPath);
            return backend.commitWorkingTree(
                { ...session.globals, identity: this.resolveIdentity(options.identity) },
                { message, kind },
            );
        });
    }

    /**
     * Put the working tree back to what one revision held, and record that as a new revision.
     *
     * **Restoring adds to history; it never rewinds it.** Restoring to `#12` writes `#12`'s content
     * over the working tree and commits the result as `#62`. Nothing between them disappears. That is
     * the only model the backend can honestly offer - it has no verb that moves a branch tip
     * backwards - and it is also the only one where a restore the author regrets is itself
     * recoverable.
     *
     * The order below is the whole of it, and every step is where it is because moving it loses
     * something:
     *
     *  1. **Enumerate the revision.** A pure read, and the step that establishes the revision exists
     *     at all - on a project with a remote it is also where the network wait happens
     *     (docs/version-control.md §6). Before the checkpoint on purpose: a restore that turns out to
     *     be impossible must not have already left a revision in the author's history for it.
     *  2. **Enumerate the working set**, which decides what may be DELETED. Only paths `isVersioned`
     *     accepts are ever enumerated, so `.nlstudio/`, `editor/cache`, `dist` and `.lore/` are
     *     outside this operation in both directions.
     *  3. **Checkpoint.** The one place in the feature where a checkpoint is taken BEFORE the act,
     *     because this is the one act that overwrites files the author may never have recorded.
     *     A failure here ABORTS the restore - "note the error and carry on" would mean overwriting
     *     their work with nothing to get it back from. "Nothing to record" is not a failure: a clean
     *     tree's pre-restore state IS the head, so there is nothing a checkpoint could add.
     *  4. **Write, then delete.** Deletions last, so an interruption leaves a tree with too much in
     *     it rather than one with holes. See `revisionRestore.ts` for why nothing recurses.
     *  5. **Commit.** The one step whose failure is REPORTED rather than thrown
     *     ({@link VcsRestoreResult.recordFailure}), because it is the only one that fails with the
     *     author's files already changed: the restored tree is on disk and uncommitted, which is a
     *     state they can see and record themselves - and step 3's checkpoint is still the way back.
     *     Thrown, it would read to every caller as "nothing happened", and the renderer would keep
     *     showing documents that are no longer what is on disk. An unchanged tree answers
     *     `revision: null` with no failure: restoring to what is already on disk changed nothing, and
     *     an empty revision is a lie about their history.
     *
     * All of it inside ONE serialization block, which is why the steps talk to `backend` directly
     * instead of calling this class's own `checkpoint` and `commit` - those serialize too, and would
     * wait on the block they are already inside.
     */
    public async restoreRevision(
        projectPath: string,
        revision: string,
        options: VcsRestoreOptions = {},
    ): Promise<VcsRestoreResult> {
        return this.serialize(projectPath, async () => {
            // First and inside the lock, exactly as for a commit: an auto-save still owed would
            // otherwise land on top of the restored bytes moments after they were written.
            if (this.flushPendingSaves) {
                await this.flushPendingSaves(projectPath).catch((error) => {
                    this.app.logger.warn("[Vcs] Could not flush pending saves before restoring", error);
                });
            }

            const { session, backend } = await this.sessionFor(projectPath);
            const globals = { ...session.globals, identity: this.resolveIdentity(options.identity) };

            const entries = await backend.listFilesAt(
                globals,
                session.store,
                session.repositoryId,
                revision,
            );
            const plan = planRevisionRestore({
                revision: entries,
                working: await readWorkingSetPaths(session.root),
            });

            const checkpoint = await backend
                .commitWorkingTree(globals, {
                    message: CHECKPOINT_MESSAGES.restore,
                    kind: "checkpoint",
                })
                .catch((error) => {
                    // The ONLY tolerated failure, and it is not one: with nothing uncommitted there is
                    // nothing for a checkpoint to hold. Anything else stops the restore before a byte
                    // is written.
                    if (isNothingToCommit(error)) return null;
                    throw error;
                });
            this.app.logger.info(
                "[Vcs] Restoring", session.root, revision,
                `${plan.write.length} write(s), ${plan.remove.length} removal(s)`,
                checkpoint ? `checkpoint ${checkpoint.revision}` : "clean tree, no checkpoint",
            );

            const applied = await applyRevisionRestore({
                projectPath: session.root,
                plan,
                source: {
                    read: (entry) => backend.readEntryBytes(
                        globals,
                        session.store,
                        session.repositoryId,
                        entry,
                    ),
                },
            });

            let recordFailure: string | null = null;
            const recorded = await backend
                .commitWorkingTree(globals, {
                    // Composed here rather than sent from the renderer, for the reason on
                    // CHECKPOINT_MESSAGES: this sentence is permanent repository content, and a
                    // history whose entries read in whichever language happened to be selected that
                    // day is worse than one that reads in English throughout. The label is a
                    // revision number, which is not language.
                    message: `Restore version ${
                        options.label?.trim() || revision.slice(0, RESTORE_MESSAGE_HASH_LENGTH)
                    }`,
                    kind: "commit",
                })
                .catch((error) => {
                    if (isNothingToCommit(error)) return null;
                    // **Reported, not thrown**, and this is the one step where those differ. Past
                    // `applyRevisionRestore` the author's files ARE the old version; a throw here
                    // reaches the renderer as "the restore failed", after which it keeps the
                    // documents it had - which are now a version that is no longer on disk, one save
                    // away from being written back over the restored tree. So the operation SUCCEEDS
                    // with the failure in hand: the caller re-reads the working tree either way and
                    // says what did not happen. Every earlier step still throws, because before this
                    // line nothing of theirs has changed.
                    recordFailure = error instanceof Error ? error.message : String(error);
                    this.app.logger.error(
                        "[Vcs] Restored the working tree but could not record it as a version",
                        session.root, recordFailure,
                    );
                    return null;
                });

            return {
                from: revision,
                checkpoint,
                revision: recorded,
                recordFailure,
                filesWritten: applied.filesWritten,
                filesRemoved: applied.filesRemoved,
            };
        });
    }

    /**
     * What has changed in the working tree since the last commit, plus where this
     * branch stands against its remote.
     *
     * The paths in the result are REPOSITORY-RELATIVE while every write verb wants
     * absolute ones, so a caller that turns a status entry into a stage or restore
     * has to convert. Both are `string`, and Lore answers an unconverted relative
     * path with success and no work done.
     */
    public async getStatus(projectPath: string): Promise<VcsStatus> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            return backend.getStatus(session.globals);
        });
    }

    /**
     * Where this project stands: its identity, its head, and the branch that head is on.
     *
     * **A pure read, and it has to stay one.** This is what the status-bar cell and the switcher
     * menu ask on every project open and after every revision, so anything here that scanned
     * would turn an ambient readout into a writer of staged state (docs §4.17). `readBranchIdentity`
     * is `scan: false, revisionOnly: true` for exactly that reason.
     *
     * It used to walk the ENTIRE revision graph, unbounded, to produce a `revisionCount` that no
     * caller in the repository ever read. Deleting the field is what makes asking for the branch
     * cheap enough to ask often.
     */
    public async getInfo(projectPath: string): Promise<VcsRepositoryInfo> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            const identity = await backend.readBranchIdentity(session.globals);
            return {
                root: session.root,
                repositoryId: session.repositoryId,
                head: identity.head,
                headNumber: identity.headNumber,
                branch: identity.branch,
            };
        });
    }

    /**
     * Revisions, newest first.
     *
     * `includeDetails` costs one backend call PER REVISION - Lore has no batch metadata
     * verb - so it is opt-in rather than always on: a history panel that paid for it
     * unconditionally would open with a few hundred round trips on a long-lived
     * project. A revision that records no kind comes back with none, which is a real
     * answer (the first commit predates kinds) and not a default of either one.
     *
     * That one call is `revisionMetadataList`, which hands back EVERY key on the
     * revision, so the flag fills in the message, timestamp and author too - which is
     * what it is named for, all four rather than the kind alone. Measured on
     * a six-revision repository (median of nine): `revisionHistory` + 6 metadata calls
     * either way - 2.5ms without kinds, 7.1ms with, where the single-key read it replaces
     * accounted for 4.2ms of that against the whole map's 5.6ms. Asking for the kind and
     * then asking again for the rest would have been the only version that cost more.
     */
    public async getHistory(
        projectPath: string,
        limit = 0,
        options: { includeDetails?: boolean } = {},
    ): Promise<VcsHistoryEntry[]> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            const graph = await backend.readRevisionGraph(session.globals, limit);
            const ordered = [...graph.values()].sort((a, b) => b.number - a.number);

            const entries: VcsHistoryEntry[] = [];
            for (const node of ordered) {
                // Sequential on purpose. Re-entering Lore concurrently on one store is
                // not a contract this binding makes, and the whole point of a single
                // reused store handle is that calls take turns on it. Which is also why
                // the cache below matters: sequential per-revision calls are the cost the
                // rail's paging would otherwise re-pay on every press.
                const details = options.includeDetails
                    ? await this.revisionDetails(session, backend, node.revision)
                    : {};
                entries.push({
                    revision: node.revision,
                    number: node.number,
                    parents: node.parents,
                    // Spread rather than four assignments so a key the revision does not
                    // carry stays ABSENT instead of arriving as an explicit undefined -
                    // which survives the IPC hop as a present-but-null field.
                    ...details,
                });
            }
            return entries;
        });
    }

    /**
     * One revision's metadata, from the session cache once anything has read it.
     *
     * The reason the cache exists is on {@link VcsSession.details}. What is worth saying here is
     * what it does NOT do: it does not merge, and it does not refresh. A revision's metadata is
     * written once when the revision is made, so the first answer is the only answer - if a future
     * verb ever lets a revision be re-labelled, this is the line that has to be revisited.
     */
    private async revisionDetails(
        session: VcsSession,
        backend: VcsBackend,
        revision: LoreHex,
    ): Promise<RevisionDetails> {
        const cached = session.details.get(revision);
        if (cached) return cached;
        const details = await backend.readRevisionDetails(session.globals, revision);
        session.details.set(revision, details);
        return details;
    }

    /**
     * Raw bytes of one file at one revision - the input to Studio's diff engine.
     * Returned as a Buffer; the IPC layer is responsible for encoding it.
     */
    public async readBlob(request: VcsBlobRequest): Promise<Buffer> {
        return this.serialize(request.projectPath, async () => {
            const { session, backend } = await this.sessionFor(request.projectPath);
            // Lore silently *ignores* a path outside the repository rather than
            // rejecting it, so the guard has to happen here.
            backend.repositoryPath(session.root, request.path);
            return backend.blobAt(
                session.globals,
                session.store,
                session.repositoryId,
                request.revision,
                request.path,
            );
        });
    }

    /** Batched sibling of readBlob; reuses one revision-tree handle. */
    public async readBlobs(
        projectPath: string,
        revision: string,
        paths: readonly string[],
    ): Promise<Map<string, Buffer>> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            for (const relative of paths) backend.repositoryPath(session.root, relative);
            return backend.blobsAt(session.globals, session.store, session.repositoryId, revision, paths);
        });
    }

    /**
     * Every document at one revision, read in a single pass over its tree.
     *
     * This is what "the workspace shows a past revision" reads through, so it answers
     * the two questions that per-path reads cannot:
     *
     *  - **absent is `null`, not a throw** - a document added after the revision has to
     *    put its editor in the same "missing, use defaults" state as at project open;
     *  - **one round trip** - the first read of a revision on a project with a remote
     *    fetches fragments over the network (docs/version-control.md §6), and nine
     *    document services asking one path at a time would pay that latency nine times.
     *
     * With no `paths`, the caller gets every file whose name matches `suffixes` and
     * whose size is within `maxBytes`. Both filters exist because the tree also holds
     * the author's assets: a project with 400MB of art would otherwise base64 the lot
     * across IPC to answer "what did this scene look like?".
     */
    public async readRevisionDocuments(
        projectPath: string,
        revision: string,
        options: { paths?: readonly string[]; suffixes?: readonly string[]; maxBytes?: number } = {},
    ): Promise<Map<string, Buffer | null>> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            if (options.paths) {
                // Lore silently *ignores* a path outside the repository rather than
                // rejecting it, so the guard has to happen here - same as readBlob.
                for (const relative of options.paths) backend.repositoryPath(session.root, relative);
            }
            const suffixes = options.suffixes ?? [".json"];
            const maxBytes = options.maxBytes ?? DEFAULT_REVISION_DOCUMENT_MAX_BYTES;
            return backend.documentsAt(
                session.globals,
                session.store,
                session.repositoryId,
                revision,
                {
                    paths: options.paths,
                    accept: (entry) => entry.size <= maxBytes
                        && suffixes.some((suffix) => entry.path.toLowerCase().endsWith(suffix)),
                },
            );
        });
    }

    /**
     * Write one revision out as a project directory the compile path can be pointed at, and answer
     * where it landed and what it cost.
     *
     * Dev Mode's reason for existing: while the workspace shows a past revision, Run has to compile
     * that revision rather than the working tree (plan 2026-07-28-002 §1). See `revisionSnapshot.ts`
     * for where the directory lives, what it deliberately leaves out, and why.
     *
     * Inside the per-project serialization, so a materialisation and a commit cannot interleave on one
     * store handle. That also means a launch waits behind an in-flight commit rather than racing it,
     * which is the right order: the revision it is about to read is only complete once that commit is.
     */
    public async materializeRevisionSnapshot(
        projectPath: string,
        revision: string,
        options: { onProgress?: (message: string) => void } = {},
    ): Promise<RevisionSnapshotResult> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            return materializeRevisionSnapshot({
                projectPath: session.root,
                revision,
                onProgress: options.onProgress,
                source: {
                    // One tree walk for the whole revision, then the bytes by address. On a project
                    // with a remote the first read fetches fragments over the network
                    // (docs/version-control.md §6), which is why the walk is not repeated per file.
                    list: () => backend.listFilesAt(
                        session.globals,
                        session.store,
                        session.repositoryId,
                        revision,
                    ),
                    read: (entry) => backend.readEntryBytes(
                        session.globals,
                        session.store,
                        session.repositoryId,
                        entry,
                    ),
                },
            });
        });
    }

    /** Paths that differ between two revisions - the filter before diffing. */
    public async getChangedPaths(projectPath: string, from: string, to: string): Promise<string[]> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            return backend.changedPaths(session.globals, from, to);
        });
    }

    /**
     * base / mine / theirs for one path, base64-encoded for transport.
     * `base` is undefined when the sides share no ancestor or the file is new on
     * both - an add/add, which must not be treated as an empty base.
     */
    public async getThreeWay(
        projectPath: string,
        mine: string,
        theirs: string,
        filePath: string,
    ): Promise<VcsThreeWayResult> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            backend.repositoryPath(session.root, filePath);
            const result = await backend.threeWay(
                session.globals,
                session.store,
                session.repositoryId,
                mine,
                theirs,
                filePath,
            );
            return {
                baseRevision: result.baseRevision,
                base: result.base ? result.base.toString("base64") : undefined,
                mine: result.mine.toString("base64"),
                theirs: result.theirs.toString("base64"),
            };
        });
    }

    /** Common ancestor of two revisions. Computed locally; Lore exposes no such API. */
    public async getMergeBase(projectPath: string, a: string, b: string): Promise<string | undefined> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            const graph = await backend.readRevisionGraph(session.globals);
            return backend.mergeBase(graph, a, b);
        });
    }

    /**
     * Release the Lore session for one project. Safe to call when none exists,
     * and cheap when the backend was never loaded.
     *
     * Flushes first. Lore's mutable store is written lazily, so a session that
     * ever wrote could otherwise lose its most recent commit - the call returns a
     * revision, then a later process sees only the previous one. Harmless for the
     * current read-only surface and load-bearing the moment writes land.
     *
     * Closing also releases Lore's exclusive repository lock, which other
     * processes block on rather than fail against.
     *
     * **Serialized like every other operation, and that is not tidiness.** This used to close the
     * store the moment a window reported itself gone, without regard for work already running on
     * it - and a history read is not instant (one metadata call per revision, taken in turn). Pull
     * the handle out from under one and the read does not fail cleanly: it is left waiting on a
     * store that no longer exists, so the panel that asked stays on "Reading the version history"
     * for the rest of the session with nothing anywhere to say why. Queuing behind the in-flight
     * work costs the close a moment and makes that state unreachable.
     *
     * The session is removed from the map BEFORE the queue, deliberately: anything arriving after
     * this call must open a fresh session rather than join one that is on its way out.
     *
     * **An open still in flight is waited for and released too.** A window can close while the
     * first read of its repository is still opening one - and that session records itself while
     * this call sits in the queue, so a close that only looked once would leave it behind holding
     * the exclusive lock. What that costs is in {@link sessionFor}: the next open of the project
     * blocks on the lock, on a libuv thread pool thread, and takes the process's file reads with it.
     */
    public async closeProject(projectPath: string): Promise<void> {
        const key = projectKey(projectPath);
        const session = this.sessions.get(key);
        // Nothing open, nothing opening, and nothing QUEUED that could open one. The last of the
        // three is not padding: a read started a moment before the window closed has not reached
        // `sessionFor` yet, so both maps are still empty while a session is on its way.
        if (!session && !this.opening.has(key) && !this.operations.has(key)) return;
        this.sessions.delete(key);
        return this.serialize(projectPath, async () => {
            // An open that is in flight right now was started outside the queue, so it settles on
            // its own rather than behind this task. Awaited for its settlement, not its value: a
            // failed open has already released its own handle.
            const opening = this.opening.get(key);
            if (opening) await opening.catch(() => undefined);
            const late = this.sessions.get(key);
            this.sessions.delete(key);
            if (session) await this.releaseSession(session);
            if (late && late !== session) await this.releaseSession(late);
        });
    }

    /** The teardown itself, run with exclusive access to the project - see {@link closeProject}. */
    private async releaseSession(session: VcsSession): Promise<void> {
        const backend = await requireVcsBackend().catch(() => null);
        if (!backend) return;

        try {
            await backend.flushRepository(session.globals);
        } catch (error) {
            this.app.logger.warn("[Vcs] Flush failed before close", session.root, error);
        }
        try {
            await backend.closeStore(session.globals, session.store);
        } catch (error) {
            this.app.logger.warn("[Vcs] Failed to close the store", session.root, error);
        }

        try {
            // Closing the store is not the same as letting go of the repository.
            // Lore keeps the repository open after the last call (storeKeepAlive),
            // and while it does, the directory cannot be deleted or moved and the
            // author's own `lore` CLI BLOCKS on the repository lock rather than
            // failing. Found the hard way: a test could not remove its own temp
            // directory after closing the store.
            await backend.releaseRepository(session.globals);
            this.app.logger.info("[Vcs] Closed session", session.root);
        } catch (error) {
            this.app.logger.warn("[Vcs] Failed to release the repository", session.root, error);
        }
    }

    /** Release every session; called on app teardown. */
    public async dispose(): Promise<void> {
        // Opens in flight included: quitting while one is still opening would otherwise leave the
        // repository locked, and on Windows that is a directory the author cannot move or delete.
        const keys = new Set([...this.sessions.keys(), ...this.opening.keys()]);
        await Promise.all([...keys].map((key) => this.closeProject(key)));
    }

    /** Exposed for diagnostics: which projects currently hold a Lore store. */
    public get openProjects(): string[] {
        return [...this.sessions.values()].map((s) => s.root);
    }
}
