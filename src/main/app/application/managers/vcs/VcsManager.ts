import { normalizeProjectPath } from "@shared/utils/recentProject";
import type {
    VcsAvailability,
    VcsBlobRequest,
    VcsHistoryEntry,
    VcsRepositoryInfo,
    VcsThreeWayResult,
} from "@shared/types/vcs";
import { BaseApp } from "../../baseApp";
import { Manager } from "../manager";
import { getVcsAvailability, requireVcsBackend, type VcsBackend } from "./backend";
// Type-only: erased at compile time, so no Lore module is reachable from here
// at load time. See backend.ts for why that matters.
import type { LoreGlobals, LoreHex, StoreHandle } from "./loreClient";

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

interface VcsSession {
    /** Repository root on disk. For now this is the project directory itself. */
    root: string;
    store: StoreHandle;
    /** Repository (partition) id, hex. Learned on first use. */
    repositoryId: LoreHex;
    globals: LoreGlobals;
}

export class VcsManager extends Manager {
    private readonly sessions = new Map<string, VcsSession>();
    /** Serializes work per project so two callers cannot interleave on one store. */
    private readonly operations = new Map<string, Promise<unknown>>();

    constructor(app: BaseApp) {
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
        const key = normalizeProjectPath(projectPath);
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

    private globalsFor(root: string): LoreGlobals {
        return {
            repositoryPath: root,
            offline: true,
            // Retain fragments fetched from a remote. Off upstream by default, which
            // would make repeated diffs of the same two revisions re-fetch every time.
            cache: true,
            storeKeepAlive: true,
        };
    }

    private async sessionFor(projectPath: string): Promise<{ session: VcsSession; backend: VcsBackend }> {
        const backend = await requireVcsBackend();
        const key = normalizeProjectPath(projectPath);
        const existing = this.sessions.get(key);
        if (existing) return { session: existing, backend };

        const root = key;
        const globals = this.globalsFor(root);
        const store = await backend.openStore(globals, root);

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
            await backend.closeStore(globals, store).catch(() => undefined);
            throw error;
        }

        const session: VcsSession = { root, store, repositoryId, globals };
        this.sessions.set(key, session);
        this.app.logger.info("[Vcs] Opened session", root, repositoryId);
        return { session, backend };
    }

    /**
     * True when this host has a working backend AND the directory is a Lore
     * repository. Returns false rather than throwing on an unsupported host, so
     * a caller can use it as a plain feature check.
     */
    public async isRepository(projectPath: string): Promise<boolean> {
        try {
            await this.sessionFor(projectPath);
            return true;
        } catch {
            return false;
        }
    }

    public async getInfo(projectPath: string): Promise<VcsRepositoryInfo> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            const graph = await backend.readRevisionGraph(session.globals);
            const ordered = [...graph.values()].sort((a, b) => b.number - a.number);
            return {
                root: session.root,
                repositoryId: session.repositoryId,
                head: ordered[0]?.revision,
                revisionCount: ordered.length,
            };
        });
    }

    public async getHistory(projectPath: string, limit = 0): Promise<VcsHistoryEntry[]> {
        return this.serialize(projectPath, async () => {
            const { session, backend } = await this.sessionFor(projectPath);
            const graph = await backend.readRevisionGraph(session.globals, limit);
            return [...graph.values()]
                .sort((a, b) => b.number - a.number)
                .map((node) => ({
                    revision: node.revision,
                    number: node.number,
                    parents: node.parents,
                }));
        });
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
            backend.client.repoPath(session.root, request.path);
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
            for (const relative of paths) backend.client.repoPath(session.root, relative);
            return backend.blobsAt(session.globals, session.store, session.repositoryId, revision, paths);
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
            backend.client.repoPath(session.root, filePath);
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
     */
    public async closeProject(projectPath: string): Promise<void> {
        const key = normalizeProjectPath(projectPath);
        const session = this.sessions.get(key);
        if (!session) return;
        this.sessions.delete(key);

        const backend = await requireVcsBackend().catch(() => null);
        if (!backend) return;

        try {
            await backend.flushRepository(session.globals);
        } catch (error) {
            this.app.logger.warn("[Vcs] Flush failed before close", session.root, error);
        }
        try {
            await backend.closeStore(session.globals, session.store);
            this.app.logger.info("[Vcs] Closed session", session.root);
        } catch (error) {
            this.app.logger.warn("[Vcs] Failed to close session", session.root, error);
        }
    }

    /** Release every session; called on app teardown. */
    public async dispose(): Promise<void> {
        await Promise.all([...this.sessions.keys()].map((key) => this.closeProject(key)));
    }

    /** Exposed for diagnostics: which projects currently hold a Lore store. */
    public get openProjects(): string[] {
        return [...this.sessions.values()].map((s) => s.root);
    }
}
