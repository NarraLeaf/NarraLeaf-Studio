import crypto from "crypto";
import { Logger } from "@shared/utils/logger";
import {
    EMPTY_STUDIO_TASK_OVERVIEW,
    type StudioTaskClaim,
    type StudioTaskId,
    type StudioTaskKind,
    type StudioTaskLane,
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
 * The queued work here is CPU-bound and already occupies the machine. Running two encodes in
 * parallel finishes neither sooner, and it makes the readout meaningless — "clip 2 of 3" only means
 * something when there is one thing in flight. So the scheduler runs exactly one such task and keeps
 * the rest in order, which is also what lets a waiting author be told there is more behind this one.
 *
 * A download is the exception, and it is an exception to the premise rather than to the rule: it
 * spends a socket, not the cores, so nothing is finished sooner by making it wait — and one a build
 * worker has already started cannot be made to wait at all. Those run in their own lane, beside the
 * queue rather than in it. See {@link StudioTaskLane}.
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
 * ## Withdrawal is the third half, and the reason a caller may name itself
 *
 * Joining is symmetric only while everyone still wants what they asked for. A caller that changes
 * its mind — an author typing a third digit into a parameter, a Dev Mode session reloading onto a
 * document that says something else — has no way to say so through a key, because the key describes
 * the clip and the clip is exactly what changed. The queue then fills with work for numbers nobody
 * will ever see, and the one the author is waiting on runs last.
 *
 * So a submission may carry a {@link StudioTaskClaim}: an owner, and which of that owner's asks this
 * is. Submitting under a new attempt retires the owner's earlier ones, which cancels whatever is
 * left of them that nobody ELSE wants. See {@link supersede} for the exact rule; the important half
 * is the negative one — a claim is an interest, never ownership, so it can never stop work somebody
 * else is waiting on.
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
     * Which resource this spends. Defaults to `machine`, which is the lane the queue is for.
     *
     * `network` work starts the moment it is submitted rather than taking its turn - see
     * {@link StudioTaskLane} for why waiting would be both pointless and, for work another process
     * has already started, a false readout.
     */
    lane?: StudioTaskLane;
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
    /** Which owners want this, and which of their asks each is on. */
    claims: Map<string, string>;
    /**
     * Whether anyone asked for this without naming themselves.
     *
     * That want can never be withdrawn - there is nobody to withdraw it - so it holds the task alive
     * however many claims come and go. Anonymous is the safe default rather than an oversight: a
     * caller that cannot say it has moved on has not.
     */
    unclaimed: boolean;
    cancelled: boolean;
    stop: (() => void) | null;
    lane: StudioTaskLane;
};

export class StudioTaskScheduler {
    private readonly queue: Entry[] = [];
    private active: Entry | null = null;
    /**
     * Network tasks, which run as soon as they are submitted and therefore never sit in the queue.
     *
     * A set rather than a single slot because two downloads genuinely can overlap - a build that
     * needs both a toolchain and a plugin's redistributable fetches them independently - and
     * because, unlike the bakes, nothing is gained by making one of them wait.
     */
    private readonly live = new Set<Entry>();
    private readonly listeners = new Set<(overview: StudioTaskOverview) => void>();
    private draining = false;

    /**
     * Queue work, or join it if the same work is already in flight.
     *
     * Returns an outcome rather than throwing, for the same reason every long path in this app does:
     * the caller is usually a UI that has to render "it failed" rather than handle an exception.
     *
     * The caller stays anonymous, which is to say it can never take this back. One that expects to
     * change its mind submits through {@link submitAll} with a claim instead.
     */
    public submit<T>(request: StudioTaskRequest<T>): Promise<StudioTaskOutcome<T>> {
        const joined = this.enter<T>(request, null);
        this.publish();
        this.pump();
        return joined;
    }

    /**
     * Submit a set of work as ONE ask, on behalf of a caller that may later want something else.
     *
     * The set is what makes this safe, and it is why {@link submit} takes no claim. A caller that
     * hands in its clips one at a time is indistinguishable from one that changed its mind between
     * them, so retirement would cut down the ask it is halfway through making. Everything submitted
     * here is claimed before anything is retired, and retirement then only ever reaches what the
     * owner wanted under an EARLIER attempt.
     *
     * An empty set with a claim is a legitimate ask rather than a no-op: it says this owner wants
     * nothing now, which is what deleting the last weather row looks like from in here.
     */
    public submitAll<T>(
        requests: readonly StudioTaskRequest<T>[],
        claim?: StudioTaskClaim,
    ): Promise<StudioTaskOutcome<T>[]> {
        const joined = requests.map(request => this.enter<T>(request, claim ?? null));
        if (claim) {
            this.supersede(claim);
        }
        this.publish();
        this.pump();
        return Promise.all(joined);
    }

    /**
     * Retire an owner's earlier asks: this attempt is what it wants, and the others were.
     *
     * Whatever it claimed under a different attempt stops being wanted by it, and a task nobody is
     * left wanting is cancelled where it stands - running included, because the running one is the
     * expensive one and letting it finish only means the wanted work starts later.
     *
     * Two things it deliberately does not do. It does not touch a task this same attempt has
     * claimed, so an ask made of several submissions never cuts its own throat; and it does not
     * touch a task another owner claimed or that anyone submitted anonymously, because a caller
     * saying it has moved on is not a caller speaking for everybody else.
     */
    public supersede(claim: StudioTaskClaim): void {
        // A copy: cancelling a queued task splices the queue underneath this loop.
        for (const entry of [this.active, ...this.queue, ...this.live]) {
            if (!entry) {
                continue;
            }
            const attempt = entry.claims.get(claim.owner);
            if (attempt === undefined || attempt === claim.attempt) {
                continue;
            }
            entry.claims.delete(claim.owner);
            if (entry.claims.size === 0 && !entry.unclaimed) {
                this.cancel(entry.key);
            }
        }
    }

    /** Join the work, or start it, and record who is asking. Neither publishes nor drains. */
    private enter<T>(request: StudioTaskRequest<T>, claim: StudioTaskClaim | null): Promise<StudioTaskOutcome<T>> {
        const existing = this.find(request.key);
        if (existing) {
            // Adopted rather than queued again. If the waiting caller is more urgent than whoever
            // started it, the work is promoted where it stands - a bake already half done is half a
            // wait already served, and restarting it to honour a priority would be strictly worse.
            this.stake(existing, claim);
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
            claims: new Map(),
            unclaimed: false,
            cancelled: false,
            stop: null,
            lane: request.lane ?? "machine",
        };
        this.stake(entry, claim);
        if (entry.lane === "network") {
            // Not queued at all: it contends with nothing, and for a download another process has
            // already opened it would be a wait that is not happening. Started by the pump below.
            this.live.add(entry);
            return this.join<T>(entry);
        }
        // Blocking work goes ahead of speculation, and behind other blocking work: someone is waiting
        // on each of those too, and reordering among them would only move the wait around.
        if (request.priority === "blocking") {
            const firstIdle = this.queue.findIndex(item => item.snapshot.priority === "idle");
            this.queue.splice(firstIdle === -1 ? this.queue.length : firstIdle, 0, entry);
        } else {
            this.queue.push(entry);
        }
        return this.join<T>(entry);
    }

    /**
     * Record one caller's interest.
     *
     * Re-staking an owner is what carries a clip across attempts: an ask that names work the owner
     * already wanted moves its claim onto the new attempt, so a bake half done is kept rather than
     * retired and started over - the same judgement promotion makes, for the same reason.
     */
    private stake(entry: Entry, claim: StudioTaskClaim | null): void {
        if (claim) {
            entry.claims.set(claim.owner, claim.attempt);
        } else {
            entry.unclaimed = true;
        }
    }

    /** Stop a task by its key, whether it is running or still waiting. */
    public cancel(key: string): void {
        const entry = this.find(key);
        if (!entry) {
            return;
        }
        entry.cancelled = true;
        entry.stop?.();
        // A task already under way settles where it is: the run function sees `cancelled` and
        // whatever it registered through `onCancel` has been called. Only one that has not started
        // can be taken off the board here, and a network task starts the instant it is submitted.
        if (entry !== this.active && entry.snapshot.status === "queued") {
            this.remove(entry);
            this.settle(entry, { status: "cancelled" }, "cancelled");
            this.publish();
        }
    }

    public getOverview(): StudioTaskOverview {
        const running = [this.active, ...this.live].filter((entry): entry is Entry => entry !== null);
        if (running.length === 0 && this.queue.length === 0) {
            return EMPTY_STUDIO_TASK_OVERVIEW;
        }
        const blocking = [...running, ...this.queue].some(entry => entry.snapshot.priority === "blocking");
        // Waiting on something beats doing something early, which is the distinction `priority`
        // exists for; a download breaks a remaining tie because it is never speculative, so of two
        // tasks that both claim to be blocking it is the one that certainly is.
        const shown = running.find(entry => entry.lane === "network" && entry.snapshot.priority === "blocking")
            ?? running.find(entry => entry.snapshot.priority === "blocking")
            ?? running.find(entry => entry.lane === "network")
            ?? running[0]
            ?? null;
        return {
            active: shown ? shown.snapshot : null,
            queued: this.queue.length + running.length - (shown ? 1 : 0),
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
        for (const entry of this.live) {
            if (entry.key === key) {
                return entry;
            }
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
        this.live.delete(entry);
    }

    private settle(entry: Entry, outcome: StudioTaskOutcome<unknown>, status: StudioTaskSnapshot["status"]): void {
        // Off the board before anyone is told, because waiters resolve synchronously: a caller that
        // looks at the overview the moment its download finishes must not still be shown that
        // download. The machine lane has already been taken off the queue by then, so this is the
        // network lane's removal in practice.
        this.remove(entry);
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

    /** Start everything that is now allowed to start, in both lanes. */
    private pump(): void {
        for (const entry of this.live) {
            if (entry.snapshot.status === "queued") {
                void this.launch(entry);
            }
        }
        void this.drain();
    }

    /** A network task, from submission to settled. Nothing waits for it, including this. */
    private async launch(entry: Entry): Promise<void> {
        await this.execute(entry);
        // `settle` has already taken it out of the live set; this is the announcement that it has.
        this.publish();
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
                await this.execute(entry);
                this.active = null;
                this.publish();
            }
        } finally {
            this.draining = false;
        }
    }

    /**
     * Run one task and settle it, whichever lane it came from.
     *
     * The lanes differ in when a task is allowed to start and in what it displaces; once running,
     * everything about it - the progress channel, the cancel handshake, the reading of a rejection -
     * is the same, and two copies of that would be two places for those judgements to drift apart.
     */
    private async execute(entry: Entry): Promise<void> {
        entry.snapshot = { ...entry.snapshot, status: "running" };
        this.publish();

        const context: StudioTaskRunContext = {
            report: progress => {
                // Dropped once the task is over: a worker can deliver a buffered report after it has
                // already finished, and it must not reopen a task the readout is done with.
                if (entry.snapshot.status === "running") {
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
            if (entry.cancelled) {
                // What a stopped task throws on its way out is the stop, not a finding: an encoder
                // that was killed reports, correctly, that it failed. Retiring a claim now cancels
                // tasks routinely, so logging those as failures would bury the real ones under the
                // ordinary consequence of typing a third digit.
                this.settle(entry, { status: "cancelled" }, "cancelled");
            } else {
                const detail = error instanceof Error ? error.message : String(error);
                // Logged here rather than by every task: a rejection escaping a background job is the
                // one failure with nobody on screen to notice it.
                logger.warn(`${entry.snapshot.kind} task failed: ${detail}`);
                this.settle(entry, { status: "error", error: detail }, "error");
            }
        }
    }

    private publish(): void {
        const overview = this.getOverview();
        for (const listener of this.listeners) {
            listener(overview);
        }
    }
}
