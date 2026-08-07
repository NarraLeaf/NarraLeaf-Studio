import type { PluginCleanup } from "@/plugin";
import type { WorkspaceContext } from "@/lib/workspace/services/services";

/**
 * What each plugin is doing *in this window*, and the queue that keeps that answer true.
 *
 * A plugin's installed record (enabled, authorized) lives in the main process and is shared by every
 * window. Whether its code is actually running is per-window and per-project: recovery mode loads
 * none of them, this project's dependency table may suppress one, and the author may switch one off
 * from the plugins panel while the workspace is open. That second fact used to live in a closure
 * inside `useWorkspacePlugins` - reachable only by unmounting the whole workspace - which is why
 * changing a plugin's state meant reopening the project.
 *
 * Every mutation runs through one per-context queue. Load, unload, and reload all touch the same
 * registrations (panels, blueprint nodes, widgets), so two overlapping ones would interleave a
 * plugin's teardown with its own setup and leave half of each behind.
 */

type SessionEntry = {
    cleanup?: PluginCleanup;
};

export type WorkspacePluginActivity = {
    /** Plugin ids whose studio entry is loaded and running here, sorted. */
    running: readonly string[];
    /** Plugin ids whose last load attempt in this window failed, with the reason. */
    failed: Readonly<Record<string, string>>;
};

const EMPTY_ACTIVITY: WorkspacePluginActivity = { running: [], failed: {} };

class WorkspacePluginSession {
    private readonly entries = new Map<string, SessionEntry>();
    private readonly failures = new Map<string, string>();
    private readonly listeners = new Set<() => void>();
    /** Cached so `useSyncExternalStore` sees a stable identity between real changes. */
    private snapshot: WorkspacePluginActivity = EMPTY_ACTIVITY;
    private queue: Promise<void> = Promise.resolve();

    public getActivity(): WorkspacePluginActivity {
        return this.snapshot;
    }

    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    public isRunning(pluginId: string): boolean {
        return this.entries.has(pluginId);
    }

    public markLoaded(pluginId: string, cleanup?: PluginCleanup): void {
        this.entries.set(pluginId, { cleanup });
        this.failures.delete(pluginId);
        this.publish();
    }

    public markFailed(pluginId: string, error: string): void {
        this.entries.delete(pluginId);
        this.failures.set(pluginId, error);
        this.publish();
    }

    /** Forget a plugin entirely - it is neither running nor failed here anymore. */
    public forget(pluginId: string): void {
        const had = this.entries.delete(pluginId) || this.failures.delete(pluginId);
        if (had) {
            this.publish();
        }
    }

    /**
     * Run the plugin's own teardown and drop it from the session.
     *
     * A cleanup that throws still counts as unloaded: `createPluginApp`'s disposer bag has already
     * reclaimed the registrations by then, and keeping the entry would leave a plugin that can
     * never be started again because the session believes it is still up.
     */
    public async unload(pluginId: string): Promise<void> {
        const entry = this.entries.get(pluginId);
        if (!entry) {
            return;
        }
        this.entries.delete(pluginId);
        this.publish();
        await entry.cleanup?.();
    }

    public async unloadAll(): Promise<void> {
        const ids = [...this.entries.keys()];
        for (const id of ids.reverse()) {
            try {
                await this.unload(id);
            } catch (error) {
                console.error(`[plugin:${id}] cleanup failed:`, error);
            }
        }
    }

    /** Serialize a mutation behind whatever else this context has in flight. */
    public enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queue.then(task);
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }

    private publish(): void {
        this.snapshot = {
            running: [...this.entries.keys()].sort(),
            failed: Object.fromEntries(this.failures),
        };
        for (const listener of this.listeners) {
            listener();
        }
    }
}

const sessions = new WeakMap<WorkspaceContext, WorkspacePluginSession>();

export function workspacePluginSession(ctx: WorkspaceContext): WorkspacePluginSession {
    const existing = sessions.get(ctx);
    if (existing) {
        return existing;
    }
    const session = new WorkspacePluginSession();
    sessions.set(ctx, session);
    return session;
}

export type { WorkspacePluginSession };
