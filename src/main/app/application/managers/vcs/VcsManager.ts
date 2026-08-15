import fs from "fs/promises";
import path from "path";
import type {
    VcsAvailability,
    VcsBlobRequest,
    VcsCheckpointReason,
    VcsCommitOptions,
    VcsCommitResult,
    VcsConflictChoice,
    VcsHistoryEntry,
    VcsMergeCompletion,
    VcsMergeDecision,
    VcsMergeDocument,
    VcsMergePerChangeDecision,
    VcsMergeResolveResult,
    VcsMergeSideChoice,
    VcsMergeState,
    VcsRepositoryInfo,
    VcsPushResult,
    VcsRestoreOptions,
    VcsRestoreResult,
    VcsRevisionDiffResult,
    VcsRevisionKind,
    VcsServerProbe,
    VcsServerReach,
    VcsServerSession,
    VcsSignInResult,
    VcsStatus,
    VcsSyncResult,
    VcsSyncState,
    VcsThreeWayResult,
    VcsWorkingFileRequest,
    VcsWorkingTreeDiffResult,
} from "@shared/types/vcs";
import { composeVcsIdentity, parseVcsRemoteUrl, VcsErrorCode, vcsSignInRequired } from "@shared/types/vcs";
import {
    composeRestoreMessage,
    VCS_CHECKPOINT_MESSAGES,
    VCS_DEFAULT_COMMIT_MESSAGE,
    VCS_DEFAULT_MERGE_MESSAGE,
} from "@shared/vcs/systemRevisionMessage";
import { BaseApp } from "../../baseApp";
import { Manager } from "../manager";
import { getVcsAvailability, requireVcsBackend, type VcsBackend } from "./backend";
// Type-only: erased at compile time, so no Lore module is reachable from here
// at load time. See backend.ts for why that matters.
import type { LoreGlobals, LoreHex, StoreHandle } from "./lore";
import type { InitRepositoryOptions } from "./repository";
// Type-only for the same reason: `revisionReader` reaches the binding, and only its shapes are
// wanted here.
import type { RevisionFileEntry } from "./revisionReader";
// Value imports, and safe to be ones for the same reason as the two below: pure policy over bytes,
// with the reader imported for types alone. `documentDiff` is also where the main process picks up
// `@shared/documents/specs`, so this edge is what populates the document registry in this process.
import { diffRevisions } from "./diff/revisionDiff";
import { diffWorkingTree } from "./diff/workingTreeDiff";
// Value import, and safe to be one: this module only touches `fs` and the working-set predicate,
// and imports the reader for types alone.
import { materializeRevisionSnapshot, type RevisionSnapshotResult } from "./revisionSnapshot";
// Same argument: policy plus `fs`, with the reader imported for types alone.
import { applyRevisionRestore, planRevisionRestore, readWorkingSetPaths } from "./revisionRestore";
// Same argument again: `fs` and the working-set predicate, and no backend anywhere in it.
import { readWorkingSetFile } from "./workingFile";
// Same again: a child process and `fs`, with no backend in it. It is a value import
// because trusting an authority happens on a failed sign-in, which is not a cold path.
import { authorityDirectory, authorityInstallPlan, runAuthorityInstall } from "./authorityTrust";
// Value import, and safe to be one for the same reason: `tls` and `https` and the module
// above, with nothing of Lore's in it. It is not behind the plug either, because asking an
// address what it is has to work on a host that has no backend to sign anything in.
import { probeVcsServer } from "./serverDiscovery";

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
     * The origin of this project's server, or null when it has none.
     *
     * Read once, on opening the session, because it decides two things every write in this
     * class needs: which signed-in account (if any) authors a revision, and which account id
     * the calls that reach the network carry. A pure local read of the repository's own config,
     * and it cannot go stale under us - {@link VcsManager.setRemote} closes the session around
     * every change to it, for a different reason that happens to guarantee this one too.
     */
    remoteOrigin: string | null;
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
    /**
     * Comparisons between two revisions, keyed `from..to`.
     *
     * Cacheable for exactly the reason {@link details} is: **both revisions are immutable**, so
     * the answer cannot go stale. The line this draws is the same one that keeps the graph out of
     * {@link details} - anything anchored to the working tree or to a moving head must not be here,
     * and {@link VcsManager.diffWorkingTree} therefore has no cache at all.
     *
     * Bounded, unlike {@link details}, because an entry is not a handful of metadata: it is up to
     * 200 changes for each of up to 2000 documents, and an author stepping through a long history
     * would otherwise accumulate all of it for the life of the window.
     */
    diffs: Map<string, VcsRevisionDiffResult>;
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
 * What Studio writes when nobody typed a message.
 *
 * The literals live in `@shared/vcs/systemRevisionMessage` rather than here, and the reason is worth
 * keeping in view: the bytes are STILL English and still permanent repository content - that
 * decision has not changed - but the rail now recognises these exact sentences and reads them back
 * in the author's language. Two copies of the wording would mean a checkpoint that quietly reverted
 * to English the day one of them was reworded, so there is one copy and both processes import it.
 */
const CHECKPOINT_MESSAGES = VCS_CHECKPOINT_MESSAGES;

const DEFAULT_COMMIT_MESSAGE = VCS_DEFAULT_COMMIT_MESSAGE;

const DEFAULT_MERGE_MESSAGE = VCS_DEFAULT_MERGE_MESSAGE;

/**
 * The two sides a path can be taken from, in the order they are applied.
 *
 * A constant rather than a literal in the loop so the two choices cannot drift from
 * {@link VcsMergeSideChoice} - adding a third whole-side verb upstream is then a type error here
 * rather than a side that is silently never applied.
 */
const MERGE_SIDES: readonly VcsMergeSideChoice[] = ["mine", "theirs"];

/** Tier two, told apart from tier one by the one value {@link MERGE_SIDES} cannot hold. */
function isPerChangeDecision(decision: VcsMergeDecision): decision is VcsMergePerChangeDecision {
    return decision.choice === "per-change";
}

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
 * A project path this layer cannot work in, said so before anything acts on it.
 *
 * Named rather than anonymous for the reason {@link isNothingToCommit} explains: callers
 * tell errors apart by name across a boundary where `instanceof` is not reliable.
 */
export class VcsProjectPathError extends Error {
    readonly code = VcsErrorCode.ProjectPath;

    constructor(readonly projectPath: string) {
        super(
            `Version control needs an absolute project path with no control characters, got `
            + `${JSON.stringify(projectPath)}. One that arrives relative, or with a newline or a `
            + `tab in it, has usually been through a layer that read its backslashes as escapes: `
            + `"D:\\Temp\\nls\\back" comes out of that as "D:Temp", a newline, "ls", a backspace, `
            + `"ack".`,
        );
        this.name = "VcsProjectPathError";
    }
}

/**
 * Refused because the app is on its way out, rather than started and abandoned.
 *
 * Not a nicety. Every Lore call is a koffi `async` call, and koffi delivers its result by
 * calling back into JS from a worker thread. A call still in flight when Node tears the main
 * process's environment down has that callback land on an environment that can no longer take
 * one, and koffi's answer to that is `napi_fatal_error` - `abort()`, SIGABRT, and the macOS
 * "NarraLeaf Studio quit unexpectedly" report on top of what the author thought was a clean
 * quit. So once {@link VcsManager.dispose} has drained the last call, nothing may start another.
 *
 * Named rather than anonymous for the reason {@link isNothingToCommit} explains.
 */
export class VcsShuttingDownError extends Error {
    readonly code = VcsErrorCode.ShuttingDown;

    constructor() {
        super("Version control is closing with the app; this call was refused rather than started");
        this.name = "VcsShuttingDownError";
    }
}

/**
 * Characters no path handed to this layer may contain.
 *
 * NUL everywhere: it terminates a C string, so a path carrying one means something different
 * on the far side of the FFI boundary than it does here. The rest of the C0 range on Windows
 * only, where such a name cannot exist at all - POSIX permits a newline in a filename and this
 * is not the place to decide otherwise.
 */
const FORBIDDEN_PATH_CHARACTERS = process.platform === "win32" ? /[\u0000-\u001f]/ : /\u0000/;

/**
 * The one spelling of a project path this manager works in: absolute, with this platform's
 * separators, and refused outright when it is neither.
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
 * to agree on a separator. `path.resolve` unifies them, and makes the path absolute, which the
 * backend requires anyway (§4.4 - relative paths resolve against the process working directory,
 * which is never the project).
 *
 * **Which is exactly why a path that is not already absolute has to be refused rather than
 * resolved.** `path.resolve` does not report that it had to invent a root; it silently answers
 * with one built from the Electron main process's working directory. A caller that hands over
 * `D:Temp\demo` - the shape a `D:\Temp\demo` takes after one round of backslash-escape processing
 * somewhere upstream - would have a repository created under Studio's own install directory and be
 * told it succeeded, with a `root` in the reply nobody asked for. Refusing costs nothing (every
 * real project path in Studio originates in the main process, from a native dialog or a config
 * file) and turns a silent relocation into a sentence naming the likely cause.
 *
 * Case is folded by {@link projectKey} on Windows only, where the filesystem is case-insensitive
 * and `D:\Demo` and `D:\demo` are one directory holding one lock.
 */
function projectRoot(projectPath: string): string {
    if (
        typeof projectPath !== "string"
        || !path.isAbsolute(projectPath)
        || FORBIDDEN_PATH_CHARACTERS.test(projectPath)
    ) {
        throw new VcsProjectPathError(String(projectPath));
    }
    return path.resolve(projectPath);
}

/** The key the session map and the operation queue use. See {@link projectRoot}. */
function projectKey(projectPath: string): string {
    const resolved = projectRoot(projectPath);
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

/**
 * How many revision comparisons one session keeps.
 *
 * Not a measurement, a bound: a comparison is orders of magnitude larger than the revision
 * metadata cached beside it, and stepping through a hundred versions must not turn into a hundred
 * change lists held for the life of the window. Twenty-four covers going back and forth across a
 * page of history, which is the pattern the cache exists for.
 */
const MAX_CACHED_REVISION_DIFFS = 24;

export class VcsManager extends Manager {
    private readonly sessions = new Map<string, VcsSession>();
    /** Serializes work per project so two callers cannot interleave on one store. */
    private readonly operations = new Map<string, Promise<unknown>>();
    /**
     * Opens in flight, so concurrent first callers share one store rather than each opening their
     * own. See {@link sessionFor} for what the second store costs.
     */
    private readonly opening = new Map<string, Promise<VcsSession>>();
    /**
     * Latched by {@link dispose} and never cleared: it is set on the way out of the process, and
     * the only thing that could clear it is the app not quitting after all, which does not happen
     * once the quit has got as far as draining. See {@link VcsShuttingDownError} for what starting
     * a call after the drain costs.
     */
    private shuttingDown = false;

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
     * The backend every call in this class starts from, refused once the app is quitting.
     *
     * One check covers the whole surface precisely because reaching the backend is the only way
     * to reach Lore: there is no verb that does not come through here first. {@link releaseSession}
     * is the one deliberate exception - it calls `requireVcsBackend` directly - because closing a
     * store is the work the latch exists to protect, not work it should refuse.
     */
    private async requireBackend(): Promise<VcsBackend> {
        if (this.shuttingDown) {
            throw new VcsShuttingDownError();
        }
        return requireVcsBackend();
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

    /**
     * The globals every call in this class runs on.
     *
     * **`offline` is the single most consequential flag here, and it defaults to on.**
     * Offline, the backend never opens a socket, so a status read from the status bar
     * cannot wait on a network no matter what a project's config says. Online, the same
     * read takes 2.03 s against a server that does not answer (measured) - affordable for
     * something the author pressed, and not for anything that happens on opening a
     * project.
     *
     * `{ online: true }` is therefore reachable from exactly five places, all of them in
     * this class and all of them named after an act the author performed: reading the
     * sync state, pushing, syncing, cloning, and signing in. Adding a sixth means
     * deciding, again, that a socket may be opened without anyone asking for it.
     */
    private globalsFor(root: string, options: { online?: boolean } = {}): LoreGlobals {
        return {
            repositoryPath: root,
            offline: !options.online,
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
        const backend = await this.requireBackend();
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
            // The normalized path rather than the key: the key is case-folded for lookup and this
            // is what is handed to the backend and used to build absolute paths off.
            const root = projectRoot(projectPath);
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

            // Local read of the repository's own config; no socket. Failure is not fatal to
            // opening: a project whose server cannot be read is one that authors revisions from
            // the settings, which is exactly what an offline project does anyway.
            const remote = await backend.readRemote(globals).catch(() => null);

            const session: VcsSession = {
                root,
                store,
                repositoryId,
                globals,
                remoteOrigin: remote ? parseVcsRemoteUrl(remote)?.origin ?? remote : null,
                details: new Map(),
                diffs: new Map(),
            };
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
            const backend = await this.requireBackend();
            const root = projectRoot(projectPath);
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
     *
     * An `explicit` identity is taken WHOLE - no email is folded into it - because a
     * caller that passes one is passing a finished identity, not a name to decorate.
     * The two settings are composed by {@link composeVcsIdentity}, which owns the
     * `Name <email>` shape and the four ways those two fields can be empty.
     */
    private resolveIdentity(explicit?: string, remoteOrigin?: string | null): string {
        const signedIn = this.storedServerSession(remoteOrigin);
        const state = this.app.getGlobalState();
        const configuredName = state.get("versionControl.authorName");
        const configuredEmail = state.get("versionControl.authorEmail");
        return explicit?.trim()
            || signedIn?.account.identity
            || composeVcsIdentity(
                typeof configuredName === "string" ? configuredName : "",
                typeof configuredEmail === "string" ? configuredEmail : "",
            )
            || UNCONFIGURED_IDENTITY;
    }

    /**
     * The identity a call that reaches the network has to carry.
     *
     * **Not the author's name, and the difference is the whole of it.** The backend keeps a
     * signed-in session in a per-user store and looks it up by the account id the server issued,
     * so an online call carrying `Ada Blackwood <ada@example.com>` where the store holds a
     * session under a random identifier fails with `No token stored` - which reads as a token
     * nobody ever presented, and is one presented under a different key.
     *
     * A project with no signed-in server falls back to the author's identity, because a bare
     * server has no session to look up and records whatever it is told. That fallback is what
     * keeps Studio working against a `loreserver` with nothing in front of it.
     */
    private resolveOnlineIdentity(remoteOrigin: string | null): string {
        return this.storedServerSession(remoteOrigin)?.account.userId ?? this.resolveIdentity();
    }

    /** The session recorded for this server, if this installation has signed in to it. */
    private storedServerSession(remoteOrigin: string | null | undefined): VcsServerSession | null {
        if (!remoteOrigin) return null;
        const stored = this.app.getGlobalState().get("versionControl.serverSessions");
        const sessions = Array.isArray(stored) ? (stored as VcsServerSession[]) : [];
        return sessions.find((session) => session.remoteOrigin === remoteOrigin) ?? null;
    }

    private writeStoredServerSessions(sessions: VcsServerSession[]): void {
        this.app.getGlobalState().set("versionControl.serverSessions", sessions);
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
                { ...session.globals, identity: this.resolveIdentity(options.identity, session.remoteOrigin) },
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
            const globals = { ...session.globals, identity: this.resolveIdentity(options.identity, session.remoteOrigin) };

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
                    message: composeRestoreMessage(
                        options.label?.trim() || revision.slice(0, RESTORE_MESSAGE_HASH_LENGTH),
                    ),
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

    /**
     * The same file as the working tree holds it now - {@link readBlob}'s other side.
     *
     * Outside the per-project serialization, and that is the point rather than an oversight: it
     * touches no store handle and no session, so queueing it behind an in-flight commit would make
     * looking at a sprite wait on a write it has nothing to do with. What it reads may therefore be
     * mid-restore, which is the same thing the author would see by opening the file themselves.
     */
    public async readWorkingFile(request: VcsWorkingFileRequest): Promise<Buffer> {
        return readWorkingSetFile(request.projectPath, request.path);
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
     * that revision rather than the working tree. See `revisionSnapshot.ts`
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

    /**
     * What changed between two revisions, as changes rather than as bytes.
     *
     * **Cached per session, and that is safe because revisions are immutable** - the same pair can
     * never answer differently, which is the identical argument {@link VcsSession.details} rests
     * on. A failed read is deliberately NOT cached: it is a fact about this process rather than
     * about the revisions - the measured case is a process that cannot read back what it wrote
     * with an online commit (docs/version-control.md §4.29) - and caching it would leave a session
     * answering with a failure that has already passed.
     *
     * Inside the per-project queue like every other verb, so a comparison and a commit cannot
     * interleave on one store handle.
     */
    public async diffRevisions(projectPath: string, from: string, to: string): Promise<VcsRevisionDiffResult> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            const key = `${from}..${to}`;
            const cached = session.diffs.get(key);
            if (cached) return cached;

            const reader = this.revisionEntryReader(session, backend);
            const result = await diffRevisions(
                {
                    changedPaths: (a, b) => backend.changedPaths(session.globals, a, b),
                    entriesAt: reader.entriesAt,
                    readAt: reader.readAt,
                },
                { from, to, onDegrade: (reason) => this.app.logger.info("[Vcs] Diff degraded:", reason) },
            );

            if (!result.readFailure) {
                this.rememberDiff(session, key, result);
            }
            return result;
        });
    }

    /**
     * What the author has changed since the last version.
     *
     * **Never cached, and the rule has no exceptions.** The working tree changes under Studio
     * between any two calls - by the author's own editing, by an auto-save, by their other tools -
     * so a remembered answer is a list of changes that may no longer exist, shown beside files that
     * no longer match it. It is also the input to the resolve flow, where a stale row means taking a
     * side on a change that is not there.
     *
     * The status read underneath scans, which is not a pure operation (§4.17), so this must be
     * called because someone asked and never on a timer.
     */
    public async diffWorkingTree(projectPath: string): Promise<VcsWorkingTreeDiffResult> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            const reader = this.revisionEntryReader(session, backend);
            return diffWorkingTree(
                {
                    status: () => backend.getStatus(session.globals),
                    entriesAt: reader.entriesAt,
                    readAt: reader.readAt,
                    // Both of these go through the backend's own guard rather than a `path.join`:
                    // a status entry is repository-relative text and these are the lines that
                    // would otherwise reach any file on the disk (§4.16 - the compiler cannot tell
                    // the two directions of path apart).
                    statWorking: async (relative) => {
                        const absolute = backend.repositoryPath(session.root, relative);
                        return fs.stat(absolute).then((stat) => ({ size: stat.size })).catch(() => null);
                    },
                    // A positioned read that stops after `length` bytes, which is what makes
                    // classifying an extensionless asset by its header affordable. `open` plus
                    // one `read` rather than a stream: the length is a few dozen bytes and the
                    // handle is closed on the way out however the read went.
                    readWorkingHead: async (relative, length) => {
                        const absolute = backend.repositoryPath(session.root, relative);
                        const handle = await fs.open(absolute, "r").catch(() => null);
                        if (!handle) {
                            return null;
                        }
                        try {
                            const buffer = Buffer.alloc(length);
                            const { bytesRead } = await handle.read(buffer, 0, length, 0);
                            return buffer.subarray(0, bytesRead);
                        } catch {
                            return null;
                        } finally {
                            await handle.close().catch(() => undefined);
                        }
                    },
                    readWorking: async (relative) => {
                        const absolute = backend.repositoryPath(session.root, relative);
                        return fs.readFile(absolute).catch(() => null);
                    },
                },
                { onDegrade: (reason) => this.app.logger.info("[Vcs] Diff degraded:", reason) },
            );
        });
    }

    /**
     * The two revision-side ports a comparison needs, sharing **one tree walk per revision**.
     *
     * The pairing is the point. `entriesAt` walks a revision's tree and reads nothing;
     * `readAt` then fetches blobs by the addresses that walk already produced, so it never
     * walks again. Issuing the two as independent calls onto the backend would walk twice, and
     * on a project with a remote the first walk of a revision can go to the network
     * (docs/version-control.md §6) - which is the same reason the reads are batched rather than
     * taken one document at a time.
     *
     * The memo lives for one comparison. Revisions are immutable, so caching it longer would be
     * sound, but a whole project's file list per revision is not a thing to hold onto for a
     * cache that already keeps the finished answers.
     */
    private revisionEntryReader(session: VcsSession, backend: VcsBackend): {
        entriesAt: (revision: string) => Promise<ReadonlyMap<string, RevisionFileEntry>>;
        readAt: (revision: string, paths: readonly string[]) => Promise<ReadonlyMap<string, Buffer | null>>;
    } {
        const walked = new Map<string, Promise<Map<string, RevisionFileEntry>>>();
        const entriesAt = (revision: string): Promise<Map<string, RevisionFileEntry>> => {
            const pending = walked.get(revision)
                ?? backend.entriesAt(session.globals, session.store, session.repositoryId, revision);
            walked.set(revision, pending);
            return pending;
        };
        return {
            entriesAt,
            readAt: async (revision, paths) => {
                const entries = await entriesAt(revision);
                const out = new Map<string, Buffer | null>();
                for (const path of paths) {
                    const entry = entries.get(path.replace(/\\/g, "/"));
                    // Absent is an answer rather than a failure: it is what tells an addition
                    // from a removal. Only a read that fails throws.
                    out.set(path, entry
                        ? await backend.readEntryBytes(session.globals, session.store, session.repositoryId, entry)
                        : null);
                }
                return out;
            },
        };
    }

    /**
     * Remember one comparison, dropping the oldest once the cap is reached.
     *
     * Insertion order rather than recency: `Map` preserves it for free, and the access pattern this
     * bounds is walking a history rail, where the oldest entry is also the one furthest from where
     * the author is looking.
     */
    private rememberDiff(session: VcsSession, key: string, result: VcsRevisionDiffResult): void {
        if (session.diffs.size >= MAX_CACHED_REVISION_DIFFS) {
            const oldest = session.diffs.keys().next();
            if (!oldest.done) session.diffs.delete(oldest.value);
        }
        session.diffs.set(key, result);
    }

    /** Common ancestor of two revisions. Computed locally; Lore exposes no such API. */
    public async getMergeBase(projectPath: string, a: string, b: string): Promise<string | undefined> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            const graph = await backend.readRevisionGraph(session.globals);
            return backend.mergeBase(graph, a, b);
        });
    }

    // -- remote ---------------------------------------------------------------

    /**
     * The server this project syncs with, or null when it has none.
     *
     * A pure LOCAL read - it reads the repository's own config file through the backend
     * and opens no socket - so it is safe to ask whenever a panel wants to know whether
     * to offer the remote controls at all. Everything below it is not.
     */
    public async getRemote(projectPath: string): Promise<string | null> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            return backend.readRemote(session.globals);
        });
    }

    /**
     * Connect this project to a server, or disconnect it by passing null.
     *
     * **Connecting is two acts, and doing only the first is the trap this method exists to
     * avoid.** Writing the address makes push and sync work; it does NOT make the project
     * clonable. Measured: a project that was only pointed at a server pushes successfully,
     * reports `remoteBranchExists: true`, and answers `Not found` to every clone - by name,
     * by repository id, and by its own name. The collaboration looks finished from the one
     * machine that set it up and does not exist from any other. So the address is written
     * AND the repository is registered, or neither happens.
     *
     * Which is why this needs the network, while {@link getRemote} does not. Rolled back on
     * a failed registration rather than left half-done: an address in the config with
     * nothing behind it is exactly the state above.
     *
     * **The session is closed around the write.** The backend reads the config when a
     * store is opened, so rewriting it under a live session would leave every later call in
     * that session dialling the OLD address - a failure that looks like the setting did not
     * save, on a screen that says it did.
     *
     * Disconnecting is purely local and cannot fail that way: it writes the unconfigured
     * placeholder and leaves whatever is on the server alone.
     */
    public async setRemote(projectPath: string, url: string | null): Promise<void> {
        const root = projectRoot(projectPath);
        // Read BEFORE the session is closed, and needed only for the connect path: the
        // registration has to carry this project's own repository id, or the name on the
        // server would resolve to a different repository than the one that pushes to it.
        const repositoryId = url ? (await this.getInfo(projectPath)).repositoryId : null;
        const previous = url ? await this.getRemote(projectPath) : null;

        // Outside the queue on purpose: `closeProject` serializes internally, and calling
        // it from inside our own block would wait on the block it is already in.
        await this.closeProject(projectPath);
        return this.serialize(projectPath, async () => {
            const backend = await this.requireBackend();
            await backend.writeRemote(root, url);
            if (!url || !repositoryId) {
                this.app.logger.info("[Vcs] Disconnected from server", root);
                return;
            }
            try {
                await backend.publishToRemote(
                    {
                        ...this.globalsFor(root, { online: true }),
                        // Registering the repository is an online call like any other, so it
                        // needs the account id when the server it is being registered on is one
                        // this installation has signed in to.
                        identity: this.resolveOnlineIdentity(parseVcsRemoteUrl(url)?.origin ?? null),
                    },
                    { url, repositoryId },
                );
            } catch (error) {
                // A server that refused because this installation has not signed in never
                // got as far as registering anything, so there is no half-made state to
                // undo - and the address is the one thing worth keeping, because signing
                // in is only reachable from a project that has a server. Putting it back
                // is what made the two steps circular: no address, no sign-in; no sign-in,
                // no address, on exactly the servers that ask who is calling.
                //
                // Every other failure still rolls back, for the reason it always did: a
                // half-registered address leaves the project able to push and unable to be
                // cloned.
                if (!vcsSignInRequired(error instanceof Error ? error.message : String(error))) {
                    await backend.writeRemote(root, previous).catch(() => undefined);
                }
                throw error;
            }
            this.app.logger.info("[Vcs] Connected to server", root, url);
        });
    }

    /**
     * Who this installation is signed in to this project's server as, or null.
     *
     * **Two stores have to agree**, and asking only one of them is how this goes wrong. Studio
     * records the account a token named; the backend records the token itself, in a per-user
     * store outside any repository that the author's own `lore` CLI can also clear. A record
     * here with nothing behind it there is an interface saying "signed in as Ada" over a
     * connection that will be refused - so the backend is asked, and a record it does not
     * recognise is dropped rather than shown.
     *
     * A purely local read: no socket, so a panel may ask on opening.
     */
    public async getServerSession(projectPath: string): Promise<VcsServerSession | null> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            return this.confirmStoredSession(backend, session);
        });
    }

    /**
     * Present a token to this project's server and keep the session.
     *
     * There is no password exchange and deliberately none: whoever runs the server mints a
     * token for a collaborator and hands it over, and the collaborator pastes it here. A token
     * lasts weeks, so this is not something anybody does daily.
     *
     * Signing in is a machine-level act rather than a project-level one - the backend stores
     * the session per user, not per repository - so one sign-in serves every project pointed
     * at the same server. The project is still where it happens, because the server address is
     * the project's and there is nowhere else to learn it.
     *
     * **The token never comes back out of this method.** It goes to the backend's store and is
     * not written to the global state, not logged and not returned.
     *
     * Ends by actually reaching the server, and the verdict is part of the answer. A sign-in
     * that succeeds against an endpoint whose data port then refuses this account is the
     * failure that otherwise turns up hours later as a push nobody can explain.
     */
    public async signIn(
        projectPath: string,
        options: { authUrl: string; token: string },
    ): Promise<VcsSignInResult> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            if (!session.remoteOrigin) {
                throw new Error(
                    "This project has no server yet. Connect it to one first, so there is somewhere"
                    + " to sign in to.",
                );
            }

            const signedIn = await backend.signInToServer(
                { ...session.globals, offline: false },
                {
                    remoteUrl: session.remoteOrigin,
                    authUrl: options.authUrl,
                    token: options.token,
                    userDataDir: this.app.getUserDataDir(),
                },
            );

            const others = this.storedServerSessions()
                .filter((stored) => stored.remoteOrigin !== signedIn.remoteOrigin);
            this.writeStoredServerSessions([...others, signedIn]);
            this.app.logger.info(
                "[Vcs] Signed in", signedIn.remoteOrigin, "at", signedIn.authUrl,
                "as", signedIn.account.username || signedIn.account.displayName,
            );

            return { session: signedIn, reach: await this.reachServer(backend, session, signedIn) };
        });
    }

    /**
     * Tell this account's trust store to believe a server's certificate authority.
     *
     * **This is the only method in Studio that changes a setting belonging to the
     * operating system**, and it exists because the alternative was not a worse
     * experience but an impossible one: the command an author was told to ask for names a
     * certificate file that lives on the server, so it could not be run on their machine.
     *
     * What the author decided is settled before this is called. The interface has already
     * shown them the authority, its fingerprint and the server it answers for, and has
     * only offered the button where the token they pasted vouches for that fingerprint.
     * See `authorityTrust.ts` for what trusting an authority costs if that decision is
     * wrong.
     *
     * **The path is checked against Studio's own directory rather than taken as given.**
     * A renderer names a file here, and a renderer is where untrusted content ends up; a
     * path passed straight to `certutil` would let a document decide which certificate
     * this machine installs. Only files this process wrote are eligible, and it wrote
     * them from a certificate an endpoint had just presented.
     */
    public async trustAuthority(certificatePath: string): Promise<{ installed: boolean; output: string }> {
        const directory = authorityDirectory(this.app.getUserDataDir());
        const target = path.resolve(certificatePath);
        if (path.dirname(target) !== path.resolve(directory) || !target.endsWith(".crt")) {
            throw new Error("That certificate is not one this installation wrote.");
        }
        await fs.access(target);

        const outcome = await runAuthorityInstall(authorityInstallPlan(target));
        this.app.logger.info(
            "[Vcs]", outcome.installed ? "Trusted" : "Failed to trust", "a server authority from", target,
        );
        return outcome;
    }

    /**
     * Take this account back off the machine.
     *
     * Clears the backend's stored token as well as Studio's record of who it belonged to.
     * Doing only the second would leave a token on the machine that nothing in the interface
     * mentions, which is the opposite of what somebody signing out is asking for.
     */
    public async signOut(projectPath: string): Promise<void> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            const stored = this.storedServerSession(session.remoteOrigin);
            if (!stored) return;

            await backend.signOutOfServer(session.globals, {
                authUrl: stored.authUrl,
                userId: stored.account.userId,
            });
            this.writeStoredServerSessions(
                this.storedServerSessions().filter((other) => other.remoteOrigin !== stored.remoteOrigin),
            );
            this.app.logger.info("[Vcs] Signed out of", stored.remoteOrigin);
        });
    }

    /**
     * Ask an address what is behind it, before anything has been added.
     *
     * The first thing that happens when somebody is handed a server, and the only call here
     * that takes neither a project nor a session: there is nothing yet to take. It is not
     * serialized for the same reason - it holds no repository and touches no store, so there
     * is nothing for a second one to collide with.
     *
     * Writes nothing but the authority's certificate, and only where the answer is that this
     * machine does not trust the server yet. That file is written before the author is asked
     * anything, because the fingerprint they are shown has to be that file's - it is the file
     * the install names.
     */
    public async probeServer(address: string): Promise<VcsServerProbe> {
        const probe = await probeVcsServer(address, { userDataDir: this.app.getUserDataDir() });
        // The address rather than the answer's, which a refused one does not carry.
        this.app.logger.info("[Vcs] Probed", address, "-", probe.kind);
        return probe;
    }

    /**
     * Every server this installation is signed in to.
     *
     * A read of Studio's own record, with no project and no socket: a session belongs to
     * the machine, and Settings lists them with nothing open. Confirming each one against
     * the backend's store is deliberately not done here - that is a call per server, and
     * this answers a panel that opens.
     */
    public listServers(): VcsServerSession[] {
        return this.storedServerSessions();
    }

    /**
     * Sign in to the server a token names, rather than to a project's server.
     *
     * **This is what makes a server a thing of its own rather than a property of a
     * project.** `signIn` above is told where to present the token, because a project
     * knows its own address; here nothing does, so the token is read first and its own
     * audience says both where to sign in and which server the session is for. Pasting a
     * token is then the whole of adding a server.
     *
     * The two addresses are corrections rather than fields: a plain `loreserver` mints
     * tokens that name neither, and for those the panel asks once, after this has answered
     * that the token says nothing.
     */
    public async addServer(
        options: { authUrl: string; remoteUrl: string; token: string },
    ): Promise<{ session: VcsServerSession; servers: VcsServerSession[] }> {
        const backend = await requireVcsBackend();
        // Reading the token is also how a paste that is not a token is refused before
        // anything is opened: it throws the same coded refusal the panel already draws.
        const read = backend.readSignInToken(options.token);
        const remoteUrl = options.remoteUrl.trim() || read.remotes[0] || "";
        if (!remoteUrl) {
            throw new backend.VcsSignInError(
                { kind: "server" },
                "This token does not say which server it is for, so the address has to be typed.",
            );
        }

        // No repository: the store this writes is per-user and outside any of them. The
        // backend wants the field, and an empty one is what the calls that have no project
        // pass - the same shape `clone` signs in under.
        const signedIn = await backend.signInToServer(
            { repositoryPath: "", offline: false, cache: false },
            {
                remoteUrl,
                authUrl: options.authUrl,
                token: options.token,
                userDataDir: this.app.getUserDataDir(),
            },
        );

        const servers = [
            ...this.storedServerSessions().filter((stored) => stored.remoteOrigin !== signedIn.remoteOrigin),
            signedIn,
        ];
        this.writeStoredServerSessions(servers);
        this.app.logger.info(
            "[Vcs] Added server", signedIn.remoteOrigin, "at", signedIn.authUrl,
            "as", signedIn.account.username || signedIn.account.displayName,
        );
        return { session: signedIn, servers };
    }

    /**
     * Take a server off this machine, the stored token with it.
     *
     * The record goes even where the backend could not be asked to drop its token. An
     * entry that cannot be removed because the machine is offline is a worse answer than
     * a token left behind: the second is written to the log and can be cleared by signing
     * in again, the first is a list nobody can correct.
     */
    public async forgetServer(remoteOrigin: string): Promise<VcsServerSession[]> {
        const stored = this.storedServerSession(remoteOrigin);
        if (!stored) return this.storedServerSessions();

        const backend = await requireVcsBackend().catch(() => null);
        if (backend) {
            await backend
                .signOutOfServer(
                    { repositoryPath: "", offline: false, cache: false },
                    { authUrl: stored.authUrl, userId: stored.account.userId },
                )
                .catch((error: unknown) => {
                    this.app.logger.warn(
                        "[Vcs] Removed", stored.remoteOrigin,
                        "without clearing its token:", error instanceof Error ? error.message : String(error),
                    );
                });
        }

        const servers = this.storedServerSessions()
            .filter((other) => other.remoteOrigin !== stored.remoteOrigin);
        this.writeStoredServerSessions(servers);
        this.app.logger.info("[Vcs] Removed server", stored.remoteOrigin);
        return servers;
    }

    /** Every session this installation has recorded, in the order they were written. */
    private storedServerSessions(): VcsServerSession[] {
        const stored = this.app.getGlobalState().get("versionControl.serverSessions");
        return Array.isArray(stored) ? (stored as VcsServerSession[]) : [];
    }

    /** The stored record for this project's server, once the backend has confirmed it exists. */
    private async confirmStoredSession(
        backend: VcsBackend,
        session: VcsSession,
    ): Promise<VcsServerSession | null> {
        const stored = this.storedServerSession(session.remoteOrigin);
        if (!stored) return null;

        const live = await backend.readServerSessions(session.globals).catch(() => null);
        // A read that failed says nothing about whether the session exists, so the record
        // stands. Only an answer that came back and did not contain it is evidence.
        if (!live) return stored;
        const present = live.some(
            (entry) => entry.userId === stored.account.userId && entry.authUrl === stored.authUrl,
        );
        if (present) return stored;

        this.writeStoredServerSessions(
            this.storedServerSessions().filter((other) => other.remoteOrigin !== stored.remoteOrigin),
        );
        this.app.logger.info("[Vcs] The stored sign-in for", stored.remoteOrigin, "is no longer held by the backend");
        return null;
    }

    /**
     * Whether this Studio and that server can actually work together, said as a word.
     *
     * Signing in proves only that the sign-in endpoint accepted the token. The work happens on
     * a different port, over a different protocol, against a server running whatever version
     * its operator installed - so the question is settled by reaching it, once, at the moment
     * somebody connects.
     *
     * Deliberately not a pair of version numbers on screen. Studio pins a client library and a
     * server runs a build nobody here chose; asking an author to compare two numbers asks them
     * to know which pairs work, which is not knowledge they have and not knowledge this
     * interface should require.
     */
    private async reachServer(
        backend: VcsBackend,
        session: VcsSession,
        signedIn: VcsServerSession,
    ): Promise<VcsServerReach> {
        try {
            const state = await backend.readSyncState({
                ...session.globals,
                offline: false,
                identity: signedIn.account.userId,
            });
            if (!state.remoteAvailable) return "dataPortSilent";
            return state.remoteAuthorized ? "ready" : "notPermitted";
        } catch (error) {
            this.app.logger.warn("[Vcs] Could not reach the server after signing in", error);
            return "dataPortSilent";
        }
    }

    /**
     * Where this branch stands against its server.
     *
     * **The one read in this class that goes online**, because the five fields it answers
     * are all false under offline globals - indistinguishable from "there is no server".
     *
     * Costs up to ~2 s when nothing answers, and reports that as `remoteAvailable: false`
     * rather than throwing: an unreachable server is information the panel has to draw,
     * not an error. Only ever called because the author asked - never on project open,
     * never on a timer.
     */
    public async getSyncState(projectPath: string): Promise<VcsSyncState> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            return backend.readSyncState({
                ...session.globals,
                offline: false,
                identity: this.resolveOnlineIdentity(session.remoteOrigin),
            });
        });
    }

    /**
     * Send this branch's revisions to the server.
     *
     * Refused by the backend when the branch has diverged, with a sentence that names the
     * remedy (`Branch has diverged, sync to merge remote changes`). That error is passed
     * through unchanged - see `remote.ts`.
     *
     * Nothing is written locally, so a failure leaves the project exactly as it was.
     */
    public async push(projectPath: string): Promise<VcsPushResult> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            const result = await backend.pushToRemote({
                ...session.globals,
                offline: false,
                // The account id, not the author's name - see `resolveOnlineIdentity`.
                identity: this.resolveOnlineIdentity(session.remoteOrigin),
            });
            this.app.logger.info(
                "[Vcs] Pushed", session.root, result.branch,
                result.alreadyPushed ? "(already up to date)" : "",
            );
            return result;
        });
    }

    /**
     * Bring the server's revisions down into the working tree.
     *
     * **This writes the author's files**, which puts it in the same category as a restore
     * and gives it the same two obligations:
     *
     *  - the renderer's pending saves are flushed FIRST and inside the lock, or a
     *    debounced auto-save lands on top of what was just synced;
     *  - the caller must re-read every document afterwards. The bytes under the editors
     *    are no longer the ones they were read from, and an editor that saves before
     *    re-reading writes the pre-sync version straight back over it.
     *
     * **A dirty working tree is refused before anything is fetched.** Syncing a diverged
     * branch merges automatically (measured), and a merge is only safe to accept when
     * there is nothing uncommitted underneath it for the merge to land on. The refusal
     * names the remedy, which is to submit a version first.
     */
    public async sync(projectPath: string): Promise<VcsSyncResult> {
        return this.serialize(projectPath, async () => {
            if (this.flushPendingSaves) {
                await this.flushPendingSaves(projectPath).catch((error) => {
                    this.app.logger.warn("[Vcs] Could not flush pending saves before syncing", error);
                });
            }

            const { session, backend } = await this.sessionFor(projectPath);
            // The account id rather than the author's name, because the fetch below is what the
            // backend looks a signed-in session up for. The revision an automatic merge records
            // therefore carries the account id while a session is in force; the author's own
            // commits do not, because those are offline and go through `resolveIdentity`.
            const globals = { ...session.globals, identity: this.resolveOnlineIdentity(session.remoteOrigin) };

            // Offline and non-scanning, so establishing the precondition costs neither a
            // socket nor the staged-state side effect a scan would have (§4.17). This
            // reports what is STAGED, which is what an uncommitted change looks like once
            // anything has staged it - and a commit is what clears it.
            const pending = await backend.getStatus(globals);
            if (!pending.clean) {
                throw new Error(
                    "There are unsubmitted changes in this project. Submit a version before syncing,"
                    + " so that anything the server sends can be merged onto a recorded state.",
                );
            }

            const result = await backend.syncFromRemote({ ...globals, offline: false });
            this.app.logger.info(
                "[Vcs] Synced", session.root,
                `${result.filesChanged} file(s), ${result.revisionsReceived} revision(s)`,
                result.conflicts.length ? `CONFLICTS: ${result.conflicts.join(", ")}` : "",
            );
            return result;
        });
    }

    // -- merge ----------------------------------------------------------------

    /**
     * Whether this project is in the middle of a merge, and which paths are still open.
     *
     * **Ask this on opening a project, not only after a sync.** A merge is repository state
     * and outlives the process that started it: the author can close the window on a
     * conflicted sync and reopen it tomorrow, and nothing in this class remembers. The
     * answer is reconstructed from the repository and from what the merge left on disk -
     * see `merge.ts` for exactly which signals, and for the one that is not an inference.
     *
     * A pure read on the offline globals: no socket, and `scan: false`, so it is not the
     * kind of status call that records staged state as a side effect (§4.17).
     */
    public async getMergeState(projectPath: string): Promise<VcsMergeState> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            return backend.readMergeState(session.globals, session.root);
        });
    }

    /**
     * The three-way merge of one conflicted document, change by change - tier two.
     *
     * **A pure read of what the merge already left on disk.** The three sides are files beside the
     * conflicted one (docs §4.23), so this needs no revision graph, no base lookup and none of
     * `getMergeBase`'s single-branch blind spot (§4.30): a merge in progress has its own inputs,
     * and they are the same bytes the two sides recorded.
     *
     * **Answers rather than throws for every reason a document cannot be settled this way.** Most
     * of a repository has no spec, most specs have no `merge3` yet, and one that has one still
     * refuses to write itself back - all three are ordinary states of ordinary files, and the
     * surface has to be able to say WHICH, because "we cannot do this here" and "there is nothing
     * left to decide here" are otherwise the same blank row.
     *
     * Queued with everything else on this project so it cannot read the sidecars while a resolve
     * is replacing them.
     */
    public async getMergeDocument(projectPath: string, documentPath: string): Promise<VcsMergeDocument> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            return backend.readMergeDocument(session.root, documentPath);
        });
    }

    /**
     * Settle conflicted paths by taking one side, or by taking the working tree as it is.
     *
     * **Records nothing.** Settling a path is not committing it - the merge stays open
     * until a commit closes it, which is what lets the author decide one file, look at the
     * result, and decide the next. The caller commits when the author says so, through
     * {@link commit}, whose globals are offline - and they must stay offline: a commit made
     * through online globals on a server-registered repository cannot be read back by the
     * process that wrote it (§4.29), so the author's own resolution would be unreadable in
     * the session that made it.
     *
     * `mine` and `theirs` OVERWRITE the working tree, so the pending saves are flushed
     * first and inside the lock for the same reason a sync flushes them: a debounced
     * auto-save landing a moment later writes the author's pre-merge document back over
     * the side they just chose.
     *
     * The caller must re-read every document this touched.
     */
    public async resolveConflicts(
        projectPath: string,
        paths: readonly string[],
        choice: VcsConflictChoice,
    ): Promise<VcsMergeResolveResult> {
        return this.serialize(projectPath, async () => {
            if (this.flushPendingSaves) {
                await this.flushPendingSaves(projectPath).catch((error) => {
                    this.app.logger.warn("[Vcs] Could not flush pending saves before resolving", error);
                });
            }
            const { session, backend } = await this.sessionFor(projectPath);
            const result = await backend.resolveConflicts(session.globals, session.root, paths, choice);
            this.app.logger.info(
                "[Vcs] Resolved", session.root, `${paths.length} path(s) as ${choice};`,
                `${result.state.conflicts.length} left`,
            );
            return result;
        });
    }

    /**
     * Take one side per path, then close the merge with a commit.
     *
     * **The whole of tier one, and one operation on purpose.** Settling and recording are the
     * same queued act, because a merge left settled-but-uncommitted is a window in which anything
     * else that commits closes it: the checkpoint timer would record the author's merge under
     * "Checkpoint", labelled `checkpoint`, and their own press would then be told nothing has
     * changed. Inside one `serialize` block that cannot happen.
     *
     * The order, and why each step is where it is:
     *
     *  1. **Flush the renderer's pending saves**, first and inside the lock - the same reason a
     *     commit does it, plus the sharper one a sync has: the resolve below OVERWRITES the paths
     *     it names, so a debounced auto-save landing a moment later writes the author's pre-merge
     *     document back over the side they just chose.
     *  2. **Compose the per-change answers, then settle, one call per side.** Grouped rather than
     *     one call per path: each of these flushes the repository, and a flush waits out the store
     *     keep-alive window (§4.22), so per-path calls would cost a second each on a merge with two
     *     hundred files. A tier-two path is written first and then settled with `working-tree`,
     *     which is the only choice that can express an answer neither side wrote.
     *  3. **Commit**, through `commitWorkingTree`, which is where the remaining three obligations
     *     already live: it confirms there is something to commit with a NON-scanning status read
     *     (§4.17), writes `narraleaf.kind` BEFORE the commit rather than after (§4.21 - the
     *     metadata verb writes the staged revision, so a label set afterwards lands on the next
     *     one), and flushes before reporting success (§4.11 - an unflushed commit can be lost
     *     outright, and it is a race rather than a stable failure).
     *
     * **Committed through the session's OFFLINE globals, and that is not incidental** (§4.29).
     * A merge is an online act; the commit that closes it must not be. Measured: on a repository
     * registered with a server, a revision committed under `offline: false` cannot have its new
     * content read back by the process that wrote it - the author's freshly resolved file would be
     * unreadable in the very session that resolved it, until Studio restarted. `session.globals`
     * is offline by construction (see {@link globalsFor}); nothing here may spread `offline: false`
     * over it, and `merge.integration.test.ts` reads the bytes back through this same manager to
     * keep that true.
     *
     * No `fileStageMerge`: measured, a plain commit records a settled merge, and the merge's own
     * `~base`/`~mine`/`~theirs` files are excluded by the backend even when the whole tree is
     * staged first (§4.23), which is exactly what this commit does.
     *
     * The caller must re-read every document afterwards - every settled path was rewritten - and
     * must hold the workspace in its view for the duration, releasing before it leaves it.
     */
    public async completeMerge(
        projectPath: string,
        decisions: readonly VcsMergeDecision[],
        options: VcsCommitOptions = {},
    ): Promise<VcsMergeCompletion> {
        return this.serialize(projectPath, async () => {
            if (this.flushPendingSaves) {
                await this.flushPendingSaves(projectPath).catch((error) => {
                    this.app.logger.warn("[Vcs] Could not flush pending saves before completing a merge", error);
                });
            }

            const { session, backend } = await this.sessionFor(projectPath);
            const globals = { ...session.globals, identity: this.resolveIdentity(options.identity, session.remoteOrigin) };

            // **Tier two, and it is written BEFORE anything is settled and after the flush above.**
            // The composed bytes are an answer neither side wrote, so they go into the working tree
            // first and are then accepted by the plain resolve verb, which commits the working tree
            // byte for byte (§4.25). Writing them before the flush would lose them to a debounced
            // auto-save; writing them after the settle would write into a path the backend has
            // already recorded.
            const perChange = decisions.filter(isPerChangeDecision);
            for (const decision of perChange) {
                await backend.resolveDocumentChanges(session.root, decision.path, decision.changes);
            }
            if (perChange.length > 0) {
                // One call for all of them, for the reason the two side groups are grouped: each
                // resolve flushes the repository and a flush waits out the keep-alive window
                // (§4.22).
                await backend.resolveConflicts(
                    globals,
                    session.root,
                    perChange.map((decision) => decision.path),
                    "working-tree",
                );
            }

            for (const choice of MERGE_SIDES) {
                const paths = decisions.filter((decision) => decision.choice === choice)
                    .map((decision) => decision.path);
                if (paths.length === 0) continue;
                await backend.resolveConflicts(globals, session.root, paths, choice);
            }

            const revision = await backend.commitWorkingTree(globals, {
                message: options.message?.trim() || DEFAULT_MERGE_MESSAGE,
                kind: "commit",
            });
            const state = await backend.readMergeState(globals, session.root);
            this.app.logger.info(
                "[Vcs] Completed merge", session.root, revision.revision,
                `${decisions.length} path(s) settled`,
                state.inProgress ? "MERGE STILL OPEN" : "",
            );
            return { revision, state };
        });
    }

    /** Put settled paths back into the unresolved state, undoing a choice. */
    public async unresolveConflicts(
        projectPath: string,
        paths: readonly string[],
    ): Promise<VcsMergeResolveResult> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            return backend.unresolveConflicts(session.globals, session.root, paths);
        });
    }

    /**
     * Redo the automatic merge for these paths, discarding what is in the working tree.
     *
     * The way back from a half-edited merge result, and it throws away bytes - so the
     * pending saves are flushed first, and the caller must re-read afterwards.
     */
    public async restartConflicts(projectPath: string, paths: readonly string[]): Promise<VcsMergeState> {
        return this.serialize(projectPath, async () => {
            if (this.flushPendingSaves) {
                await this.flushPendingSaves(projectPath).catch((error) => {
                    this.app.logger.warn("[Vcs] Could not flush pending saves before restarting a merge", error);
                });
            }
            const { session, backend } = await this.sessionFor(projectPath);
            return backend.restartConflicts(session.globals, session.root, paths);
        });
    }

    /**
     * Abandon the merge and put the working tree back to what it was before it started.
     *
     * **A complete rollback, measured rather than assumed** (§4.27): every file back to its
     * pre-merge content, the merge inputs deleted, the status header where it was. That
     * measurement is the only reason this is offered at all - a cancel that left a
     * half-merged tree would be worse than no cancel.
     *
     * It writes the author's files, so it carries a restore's obligations: pending saves
     * flushed first and inside the lock, and every document re-read once it resolves.
     */
    public async abortMerge(projectPath: string): Promise<VcsMergeState> {
        return this.serialize(projectPath, async () => {
            if (this.flushPendingSaves) {
                await this.flushPendingSaves(projectPath).catch((error) => {
                    this.app.logger.warn("[Vcs] Could not flush pending saves before abandoning a merge", error);
                });
            }
            const { session, backend } = await this.sessionFor(projectPath);
            const state = await backend.abortMerge(session.globals, session.root);
            this.app.logger.info("[Vcs] Abandoned the merge", session.root);
            return state;
        });
    }

    /**
     * Copy a repository from a server into a local directory.
     *
     * Takes no project session and cannot: there is no repository here until this
     * finishes. It works on bare globals for the same reason {@link initRepository} does,
     * and like that method it releases the repository afterwards - the backend keeps it
     * open otherwise, and on Windows that is a folder the author cannot move or delete.
     *
     * The destination must be empty. That guard is in `remote.ts` because the backend
     * has none: it writes the working tree into whatever it is pointed at.
     */
    public async cloneRepository(
        repositoryUrl: string,
        destination: string,
        options: { onProgress?: (transferred: number, total: number) => void } = {},
    ): Promise<{ root: string; branch: string; fileCount: number }> {
        const root = projectRoot(destination);
        return this.serialize(root, async () => {
            const backend = await this.requireBackend();
            const globals = this.globalsFor(root, { online: true });
            try {
                const cloned = await backend.cloneInto(
                    {
                        ...globals,
                        // Online, so the account id if this installation has signed in to the
                        // server the copy is coming from.
                        identity: this.resolveOnlineIdentity(parseVcsRemoteUrl(repositoryUrl)?.origin ?? null),
                    },
                    { repositoryUrl, onProgress: options.onProgress },
                );
                this.app.logger.info("[Vcs] Cloned", repositoryUrl, "->", root, `${cloned.fileCount} file(s)`);
                return { root, ...cloned };
            } finally {
                // No session was opened here, so nothing else will let go of the
                // repository - and a half-finished clone holds it too, which is why this
                // is in the `finally`.
                await backend.releaseRepository(globals).catch((error) => {
                    this.app.logger.warn("[Vcs] Failed to release after clone", root, error);
                });
            }
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

    /**
     * Release every session and stop taking new work. Awaited on the way out of the app.
     *
     * **Awaited, and that is the whole point.** Closing a store is itself three Lore calls, so
     * firing this off and quitting anyway leaves koffi work in flight while Node destroys the
     * environment underneath it - which is not a leak but a SIGABRT (see
     * {@link VcsShuttingDownError}). The latch is set first so that nothing arriving during the
     * drain - a renderer's interval checkpoint, a window closing behind us - can open a session
     * this call has already walked past.
     *
     * Three sets of keys, because a project can be in any of three states and only the first is
     * obvious. Opens in flight: quitting during one would otherwise leave the repository locked,
     * and on Windows that is a directory the author cannot move or delete. Queued operations: a
     * verb that has not reached `sessionFor` yet is in neither of the other two maps, and
     * `closeProject` waits behind it rather than racing it.
     *
     * A failure to close one project does not stop the others; the alternative is a rejected
     * `Promise.all` that abandons the sessions it had not got to yet.
     */
    public async dispose(): Promise<void> {
        this.shuttingDown = true;
        const keys = new Set([...this.sessions.keys(), ...this.opening.keys(), ...this.operations.keys()]);
        await Promise.all([...keys].map((key) => this.closeProject(key).catch((error) => {
            this.app.logger.warn("[Vcs] Failed to close a session while quitting", key, error);
        })));
    }

    /**
     * Whether anything is still talking to Lore. Read after a bounded drain to say, in the log,
     * whether the quit is about to do the one thing {@link dispose} exists to prevent.
     */
    public get busy(): boolean {
        return this.operations.size > 0 || this.opening.size > 0;
    }

    /** Exposed for diagnostics: which projects currently hold a Lore store. */
    public get openProjects(): string[] {
        return [...this.sessions.values()].map((s) => s.root);
    }
}
