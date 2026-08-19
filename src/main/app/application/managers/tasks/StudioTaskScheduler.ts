import crypto from "crypto";
import { Logger } from "@shared/utils/logger";
import {
    EMPTY_STUDIO_TASK_OVERVIEW,
    type StudioTaskId,
    type StudioTaskKind,
    type StudioTaskOverview,
    type StudioTaskPriority,
    type StudioTaskProgress,
    type StudioTaskSnapshot,
} from "@shared/types/studioTask";

/**
 * The one queue Studio's long work goes through.
 *
 * ## One at a time, and why that is the design rather than a limitation
 *
 * Every task here is CPU-bound and already occupies the machine. Running two encodes in parallel
 * finishes neither sooner, and it makes the readout meaningless — "clip 2 of 3" only means something
 * when there is one thing in flight. So the scheduler runs exactly one task and keeps the rest in
 * order, which is also what lets a waiting author be told there is more behind this one.
 *
 * ## Deduplication is the feature, not an optimisation
 *
 * A task carries a key describing the work rather than the request. Submitting work that is already
 * queued or running joins it: the second caller gets the first task's promise, and nothing runs
 * twice. That is what makes speculative work safe — Studio can start a bake while the author is
 * still typing, and when they press Run a moment later, Run adopts the bake in flight instead of
 * queueing a duplicate behind it.
 *
 * Promotion is the other half. An `idle` task that someone starts waiting on becomes `blocking` and
 * moves to the front of the queue; if it is already running it simply changes its label, because
 * there is nothing better to do with work that is already half done.
 *
 * ## What this deliberately does not do
 *
 * It does not decide WHEN to speculate. Debouncing an author's typing, noticing that a document
 * settled, choosing not to pre-bake on battery — those are judgements about the thing being watched,
 * and they belong to whoever is watching it. This is the executor.
 */

const logger = new Logger("StudioTasks");

/** What a caller hands in: the work, plus everything needed to talk about it while it runs. */
export type StudioTaskRequest<T> = {
    kind: StudioTaskKind;
    /**
     * What this work IS, as a string.
     *
     * Two submissions with the same key are the same work — that is the whole contract, and it is
     * why the key must describe the OUTPUT rather than the request. A weather bake keys on the clip
     * it would produce, so two rows asking for the same snow are one task.
     */
    key: string;
    priority: StudioTaskPriority;
    /**
     * Do the work. `report` is how progress reaches the snapshot; a task that cannot measure itself
     * simply never calls it, and its progress stays null.
     */
    run: (context: StudioTaskRunContext) => Promise<T>;
};

export type StudioTaskRunContext = {
    report: (progress: StudioTaskProgress) => void;
    /** True once someone has asked this task to stop. Long loops should check it. */
    readonly cancelled: boolean;
    /** Registered by the task so a cancel can reach whatever it is driving. */
    onCancel: (stop: () => void) => void;
};

export type StudioTaskOutcome<T> =
    | { status: "done"; value: T }
    | { status: "cancelled" }
    | { status: "error"; error: string };

type Entry = {
    snapshot: StudioTaskSnapshot;
    key: string;
    run: (context: StudioTaskRunContext) => Promise<unknown>;
    /** Everyone waiting on this work, however many times it was submitted. */
    waiters: ((outcome: StudioTaskOutcome<unknown>) => void)[];
    cancelled: boolean;
    stop: (() => void) | null;
};

export class StudioTaskScheduler {
    private readonly queue: Entry[] = [];
    private active: Entry | null = null;
    private readonly listeners = new Set<(overview: StudioTaskOverview) => void>();
    private draining = false;

    /**
     * Queue work, or join it if the same work is already in flight.
     *
     * Returns an outcome rather than throwing, for the same reason every long path in this app does:
     * the caller is usually a UI that has to render "it failed" rather than handle an exception.
     */
    public submit<T>(request: StudioTaskRequest<T>): Promise<StudioTaskOutcome<T>> {
        const existing = this.find(request.key);
        if (existing) {
            // Adopted rather than queued again. If the waiting caller is more urgent than whoever
            // started it, the work is promoted where it stands - a bake already half done is half a
            // wait already served, and restarting it to honour a priority would be strictly worse.
            if (request.priority === "blocking" && existing.snapshot.priority === "idle") {
                existing.snapshot = { ...existing.snapshot, priority: "blocking" };
                this.moveToFront(existing);
            }
            return this.join<T>(existing);
        }

        const entry: Entry = {
            snapshot: {
                id: crypto.randomUUID() as StudioTaskId,
                kind: request.kind,
                status: "queued",
                priority: request.priority,
                progress: null,
            },
            key: request.key,
            run: request.run as (context: StudioTaskRunContext) => Promise<unknown>,
            waiters: [],
            cancelled: false,
            stop: null,
        };
        // Blocking work goes ahead of speculation, and behind other blocking work: someone is waiting
        // on each of those too, and reordering among them would only move the wait around.
        if (request.priority === "blocking") {
            const firstIdle = this.queue.findIndex(item => item.snapshot.priority === "idle");
            this.queue.splice(firstIdle === -1 ? this.queue.length : firstIdle, 0, entry);
        } else {
            this.queue.push(entry);
        }
        const joined = this.join<T>(entry);
        this.publish();
        void this.drain();
        return joined;
    }

    /** Stop a task by its key, whether it is running or still waiting. */
    public cancel(key: string): void {
        const entry = this.find(key);
        if (!entry) {
            return;
        }
        entry.cancelled = true;
        entry.stop?.();
        if (entry !== this.active) {
            this.remove(entry);
            this.settle(entry, { status: "cancelled" }, "cancelled");
            this.publish();
        }
    }

    public getOverview(): StudioTaskOverview {
        if (!this.active && this.queue.length === 0) {
            return EMPTY_STUDIO_TASK_OVERVIEW;
        }
        const blocking = [this.active, ...this.queue].some(entry => entry?.snapshot.priority === "blocking");
        return {
            active: this.active ? this.active.snapshot : null,
            queued: this.queue.length,
            blocking,
        };
    }

    public onChanged(listener: (overview: StudioTaskOverview) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private find(key: string): Entry | null {
        if (this.active?.key === key) {
            return this.active;
        }
        return this.queue.find(entry => entry.key === key) ?? null;
    }

    private join<T>(entry: Entry): Promise<StudioTaskOutcome<T>> {
        return new Promise<StudioTaskOutcome<T>>(resolve => {
            entry.waiters.push(outcome => resolve(outcome as StudioTaskOutcome<T>));
        });
    }

    private moveToFront(entry: Entry): void {
        const index = this.queue.indexOf(entry);
        if (index > 0) {
            this.queue.splice(index, 1);
            this.queue.unshift(entry);
        }
        this.publish();
    }

    private remove(entry: Entry): void {
        const index = this.queue.indexOf(entry);
        if (index !== -1) {
            this.queue.splice(index, 1);
        }
    }

    private settle(entry: Entry, outcome: StudioTaskOutcome<unknown>, status: StudioTaskSnapshot["status"]): void {
        entry.snapshot = {
            ...entry.snapshot,
            status,
            ...(outcome.status === "error" ? { error: outcome.error } : {}),
        };
        // Every waiter, however many times the work was submitted, and once each.
        const waiters = entry.waiters.splice(0, entry.waiters.length);
        for (const waiter of waiters) {
            waiter(outcome);
        }
    }

    private async drain(): Promise<void> {
        if (this.draining) {
            return;
        }
        this.draining = true;
        try {
            while (this.queue.length > 0) {
                const entry = this.queue.shift();
                if (!entry) {
                    break;
                }
                this.active = entry;
                entry.snapshot = { ...entry.snapshot, status: "running" };
                this.publish();

                const context: StudioTaskRunContext = {
                    report: progress => {
                        // Dropped once the task is over: a worker can deliver a buffered report after
                        // it has already finished, and it must not reopen a task the readout is done
                        // with.
                        if (this.active === entry && entry.snapshot.status === "running") {
                            entry.snapshot = { ...entry.snapshot, progress };
                            this.publish();
                        }
                    },
                    get cancelled() {
                        return entry.cancelled;
                    },
                    onCancel: stop => {
                        entry.stop = stop;
                        if (entry.cancelled) {
                            stop();
                        }
                    },
                };

                try {
                    const value = await entry.run(context);
                    this.settle(entry, entry.cancelled ? { status: "cancelled" } : { status: "done", value }, entry.cancelled ? "cancelled" : "done");
                } catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    // Logged here rather than by every task: a rejection escaping a background job is
                    // the one failure with nobody on screen to notice it.
                    logger.warn(`${entry.snapshot.kind} task failed: ${detail}`);
                    this.settle(entry, { status: "error", error: detail }, "error");
                }
                this.active = null;
                this.publish();
            }
        } finally {
            this.draining = false;
        }
    }

    private publish(): void {
        const overview = this.getOverview();
        for (const listener of this.listeners) {
            listener(overview);
        }
    }
}
