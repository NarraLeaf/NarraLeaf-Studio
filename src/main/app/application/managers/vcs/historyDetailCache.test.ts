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
    let nodes: { revision: string; number: number; parents: string[] }[] = [];

    const backend = {
        openStore: async () => ({ handleId: 1 }),
        closeStore: async () => undefined,
        flushRepository: async () => undefined,
        releaseRepository: async () => undefined,
        readRepositoryIdentity: async () => ({ repository: "repo0", branch: "main" }),
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
            detailReads.push(revision);
            return { kind: "commit", message: `message for ${revision}` };
        },
    };

    return {
        backend,
        detailReads,
        /** A linear history `count` revisions long, `r1` oldest. Clears the call log with it. */
        reset: (count: number) => {
            detailReads.length = 0;
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
