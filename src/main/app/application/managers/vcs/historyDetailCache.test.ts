import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseApp } from "../../baseApp";
import { VcsManager } from "./VcsManager";

/**
 * The per-session revision-metadata cache, which is what makes the version rail's paging affordable.
 *
 * The rail pages by re-reading the history with a LARGER LIMIT, because the backend offers no cursor
 * - `readRevisionGraph(globals, limit)` is the whole of its history surface. Details cost one backend
 * call per revision, taken in turn, so without a cache the fifth press pays 250 calls to gain 50 new
 * rows. What this file pins is the one property that makes that acceptable: a revision's metadata is
 * asked for ONCE per session, however many reads walk past it.
 *
 * **Deliberately not an integration test, and deliberately not in one of the files that are.** The
 * question here is Studio's own bookkeeping - how many times the manager calls out - and a fake
 * backend answers it exactly, while a real repository would only show a difference in wall-clock time.
 * The real-library concerns (Lore's key names, the timestamp's unit) are pinned next door in
 * `revisionDetails.integration.test.ts`; mixing the two into one file would make this file skip on
 * every host without a native build, which is the half of the fleet most likely to run it
 * (docs/version-control.md §4.13 for why availability tests and happy-path tests live apart).
 */

const lore = vi.hoisted(() => {
    /** Every revision `readRevisionDetails` was asked about, in order and with repeats. */
    const detailReads: string[] = [];
    /** Everything that happened, in order, across reads and teardown. For the ordering test below. */
    const trace: string[] = [];
    /** Every root a store was opened against. One per project, however the caller spelled it. */
    const opens: string[] = [];
    let nodes: { revision: string; number: number; parents: string[] }[] = [];
    /**
     * Makes one detail read block until released, so a test can hold a read open and ask what the
     * teardown does while it is running. Null - not blocking - for every other test in the file.
     */
    let gate: Promise<void> | null = null;
    /** Fired the first time a read reaches the gate, so a test never guesses at microtask counts. */
    let announceArrival: (() => void) | null = null;

    const backend = {
        openStore: async (_globals: unknown, root: string) => {
            opens.push(root);
            return { handleId: opens.length };
        },
        closeStore: async () => {
            trace.push("closeStore");
        },
        flushRepository: async () => undefined,
        releaseRepository: async () => {
            trace.push("releaseRepository");
        },
        readRepositoryIdentity: async () => ({ repository: "repo0", branch: "main" }),
        // Read once when a session opens: it is what decides whose name goes on a
        // revision and which account id the online calls carry. Null is "no server".
        readRemote: async () => null,
        /**
         * Newest first, cut to `limit` - and the cut is at the NEWEST end, which is what makes a
         * larger limit reach further back rather than sideways. That is the behaviour the cache is
         * built against: every deeper read re-covers everything the shallower one already saw.
         */
        readRevisionGraph: async (_globals: unknown, limit = 0) => {
            const ordered = [...nodes].sort((a, b) => b.number - a.number);
            const page = limit > 0 ? ordered.slice(0, limit) : ordered;
            return new Map(page.map((node) => [node.revision, node]));
        },
        readRevisionDetails: async (_globals: unknown, revision: string) => {
            if (gate) {
                announceArrival?.();
                await gate;
            }
            detailReads.push(revision);
            trace.push(`detail:${revision}`);
            return { kind: "commit", message: `message for ${revision}` };
        },
    };

    return {
        backend,
        detailReads,
        trace,
        opens,
        /**
         * Hold every subsequent detail read open.
         *
         * `arrived` resolves once a read is actually sitting in the gate, which is the only honest
         * way for a test to say "the work is in flight now" - counting microtasks would be guessing
         * at how many awaits the manager happens to have between the call and the backend today.
         */
        block: () => {
            let release = () => undefined as void;
            gate = new Promise<void>((resolve) => {
                release = () => resolve();
            });
            const arrived = new Promise<void>((resolve) => {
                announceArrival = () => {
                    announceArrival = null;
                    resolve();
                };
            });
            return {
                arrived,
                release: () => {
                    gate = null;
                    announceArrival = null;
                    release();
                },
            };
        },
        /** A linear history `count` revisions long, `r1` oldest. Clears the call log with it. */
        reset: (count: number) => {
            detailReads.length = 0;
            trace.length = 0;
            opens.length = 0;
            gate = null;
            nodes = [];
            for (let number = count; number >= 1; number--) {
                nodes.push({
                    revision: `r${number}`,
                    number,
                    parents: number > 1 ? [`r${number - 1}`] : [],
                });
            }
        },
    };
});

/**
 * The manager reaches the backend through exactly one module, which is what makes this mockable at
 * all - and what keeps the native library out of this file entirely (see `backend.ts`).
 *
 * The fake's own state lives in a `vi.hoisted` block above, because both this factory and the import
 * of `VcsManager` are lifted above every ordinary declaration in the file.
 */
vi.mock("./backend", () => ({
    requireVcsBackend: async () => lore.backend,
    getVcsAvailability: async () => ({ available: true }),
}));

/** A path, never touched on disk - nothing in this file reaches the file system. */
const PROJECT = "/projects/prologue";

function fakeApp(): BaseApp {
    const noop = () => undefined;
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        getGlobalState: () => ({ get: () => undefined }),
    } as unknown as BaseApp;
}

let manager: VcsManager;

beforeEach(() => {
    lore.reset(6);
    manager = new VcsManager(fakeApp());
});

describe("revision detail cache", () => {
    it("asks the backend about one revision once, however many reads walk past it", async () => {
        // Two reads at two depths, the way the rail pages: open the panel, then press for more.
        const first = await manager.getHistory(PROJECT, 3, { includeDetails: true });
        const second = await manager.getHistory(PROJECT, 6, { includeDetails: true });

        expect(first.map((entry) => entry.revision)).toEqual(["r6", "r5", "r4"]);
        expect(second.map((entry) => entry.revision)).toEqual(["r6", "r5", "r4", "r3", "r2", "r1"]);

        // Six calls for six revisions. Without the cache the second read re-pays for the three it
        // already had, which is nine - and on a real project, at the fifth press, 250.
        expect(lore.detailReads).toEqual(["r6", "r5", "r4", "r3", "r2", "r1"]);
    });

    it("still answers with the metadata on the pages that were served from the cache", async () => {
        // The cost is the point of the cache, but silence is the way it could fail: an entry served
        // from a cache that stored the wrong thing renders as a revision that says nothing about
        // itself, which is a real state (the first commit) and so raises no alarm anywhere.
        await manager.getHistory(PROJECT, 3, { includeDetails: true });
        const second = await manager.getHistory(PROJECT, 6, { includeDetails: true });

        expect(second[0]).toMatchObject({ revision: "r6", kind: "commit", message: "message for r6" });
        expect(second[5]).toMatchObject({ revision: "r1", kind: "commit", message: "message for r1" });
    });

    it("does not read details at all when the caller did not ask for them", async () => {
        // The flag is what keeps a history panel from opening with a few hundred round trips; a
        // cache that warmed itself on a plain read would give that cost back.
        const entries = await manager.getHistory(PROJECT, 6);

        expect(entries).toHaveLength(6);
        expect(entries[0].message).toBeUndefined();
        expect(lore.detailReads).toEqual([]);
    });

    it("keeps two projects' revisions apart", async () => {
        // The cache hangs off the per-project session for the same reason everything else in this
        // manager does: one project's answers must never be served to another's window. Same
        // revision ids on purpose - a cache keyed on the revision alone would pass this by luck.
        await manager.getHistory(PROJECT, 6, { includeDetails: true });
        await manager.getHistory("/projects/epilogue", 6, { includeDetails: true });

        expect(lore.detailReads).toHaveLength(12);
    });

    it("forgets them when the project closes, because the session they hang off is gone", async () => {
        await manager.getHistory(PROJECT, 6, { includeDetails: true });
        expect(lore.detailReads).toHaveLength(6);

        await manager.closeProject(PROJECT);
        await manager.getHistory(PROJECT, 6, { includeDetails: true });

        // Re-read rather than answered from a cache that outlived its store handle. The cache is
        // memory attached to an open repository, not a durable index.
        expect(lore.detailReads).toHaveLength(12);
    });
});

/**
 * Closing a project must not pull the store out from under work already running on it.
 *
 * A window reporting itself closed is not a promise that nothing is using the repository: reading a
 * history is one metadata call per revision taken in turn, so on a real project it is comfortably
 * long enough to still be running. Closing the store underneath one does not fail it cleanly - the
 * read is left waiting on a handle that no longer exists, and the panel that asked for it sits on
 * "Reading the version history" with nothing anywhere to explain it.
 */
/**
 * One directory is one project however the caller spelled its path.
 *
 * This is not a tidiness concern. The session map and the operation queue are what stop two calls
 * meeting on one store, and Lore's repository lock is exclusive and BLOCKING - so a second key for
 * the same directory does not produce a duplicate cache, it produces a process waiting on itself
 * with no error, no CPU and no end. Observed in a running Studio: the panel sat on "Submitting this
 * version" indefinitely while an unqueued call answered in 0ms.
 *
 * The spellings are the ones that really occur: the window-close paths take the project path from
 * the window's props, the renderer sends the one out of the project config, and nothing has ever
 * made those agree on a separator.
 */
describe("one project, however its path is spelled", () => {
    const SPELLINGS = process.platform === "win32"
        ? ["D:\\projects\\prologue", "D:/projects/prologue", "D:\\Projects\\Prologue", "D:\\projects\\prologue\\"]
        : ["/projects/prologue", "/projects/./prologue", "/projects/prologue/"];

    it("opens exactly one store for all of them", async () => {
        for (const spelling of SPELLINGS) {
            await manager.getHistory(spelling, 6, { includeDetails: true });
        }

        expect(lore.opens).toHaveLength(1);
        // And one session means one cache: six revisions read once, not once per spelling.
        expect(lore.detailReads).toHaveLength(6);
    });

    it("runs them through one queue, so they cannot meet on the same store", async () => {
        const gate = lore.block();
        const first = manager.getHistory(SPELLINGS[0], 6, { includeDetails: true });
        await gate.arrived;

        // A second spelling while the first is still in the backend. On the old keying this opened
        // its own store and blocked forever on the lock the first one holds.
        const second = manager.getHistory(SPELLINGS[1], 6, { includeDetails: true });
        gate.release();

        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
        expect(lore.opens).toHaveLength(1);
    });
});

describe("closing a project", () => {
    it("waits for work already running before it lets the store go", async () => {
        const gate = lore.block();
        const reading = manager.getHistory(PROJECT, 6, { includeDetails: true });
        // The read is genuinely in the backend now, session opened and all - not merely scheduled.
        await gate.arrived;

        const closing = manager.closeProject(PROJECT);
        gate.release();
        const entries = await reading;
        await closing;

        // The read finished, and finished COMPLETE - a truncated page is the other way this could
        // go wrong, and it would look like a project whose history simply is that short.
        expect(entries.map((entry) => entry.revision)).toEqual(["r6", "r5", "r4", "r3", "r2", "r1"]);
        // Every detail read is ahead of the teardown in the trace, which is the actual claim.
        expect(lore.trace.indexOf("closeStore")).toBeGreaterThan(lore.trace.lastIndexOf("detail:r1"));
        expect(lore.trace.at(-1)).toBe("releaseRepository");
    });

    it("sends the next caller to a fresh session rather than the one on its way out", async () => {
        await manager.getHistory(PROJECT, 6, { includeDetails: true });

        const gate = lore.block();
        const closing = manager.closeProject(PROJECT);
        // Asked while the close is queued: the session is already out of the map, so this must not
        // join it and must not be answered out of its cache.
        const nextRead = manager.getHistory(PROJECT, 6, { includeDetails: true });
        await gate.arrived;
        gate.release();
        await closing;
        await nextRead;

        expect(lore.detailReads).toHaveLength(12);
    });
});
