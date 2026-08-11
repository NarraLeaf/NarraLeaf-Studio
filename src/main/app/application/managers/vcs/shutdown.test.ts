import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseApp } from "../../baseApp";
import { VcsManager, VcsShuttingDownError } from "./VcsManager";

/**
 * Putting Lore down before the process goes.
 *
 * The failure this exists to prevent does not look like a version control bug at all: quitting
 * Studio from the Dock produced a macOS crash report, `SIGABRT` in `koffi.node`, on a quit the
 * author saw nothing wrong with. Every Lore call is a koffi `async` call whose result is
 * delivered by calling back into JS, and the sessions were being closed by a fire-and-forget
 * `closeProject` on window close - which, during a quit, starts three Lore calls at the moment
 * Node begins destroying the environment they must report back into. koffi's answer to a callback
 * with nowhere to land is `napi_fatal_error`, which is `abort()`.
 *
 * So the property under test is not "sessions are closed" but "the quit WAITS for them, and
 * nothing starts another call afterwards". A fake backend rather than a repository, because the
 * question is about ordering between calls rather than about what any of them returns.
 */

const lore = vi.hoisted(() => {
    const calls: string[] = [];
    /** Held by {@link hold}, so one call can be kept open across a dispose. */
    let gate: Promise<void> | null = null;
    let openGate: (() => void) | null = null;

    const backend = {
        openStore: async () => {
            calls.push("openStore");
            return { handleId: 1 };
        },
        closeStore: async () => {
            calls.push("closeStore");
        },
        flushRepository: async () => {
            calls.push("flushRepository");
        },
        releaseRepository: async () => {
            calls.push("releaseRepository");
        },
        readRepositoryIdentity: async () => ({ repository: "repo0", branch: "main" }),
        readBranchIdentity: async () => {
            calls.push("readBranchIdentity");
            if (gate) await gate;
            return { head: "r2", headNumber: 2, branch: "main" };
        },
    };

    return {
        backend,
        calls,
        /** Make the next `readBranchIdentity` block; the returned function lets it finish. */
        hold(): () => void {
            gate = new Promise<void>((resolve) => {
                openGate = resolve;
            });
            return () => {
                const release = openGate;
                gate = null;
                openGate = null;
                release?.();
            };
        },
        release() {
            const open = openGate;
            gate = null;
            openGate = null;
            open?.();
        },
    };
});

vi.mock("./backend", () => ({
    requireVcsBackend: async () => lore.backend,
    getVcsAvailability: async () => ({ available: true }),
}));

const PROJECT = "/projects/prologue";
const OTHER = "/projects/epilogue";

function fakeApp(): BaseApp {
    const noop = () => undefined;
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        getGlobalState: () => ({ get: () => undefined }),
    } as unknown as BaseApp;
}

/** Let every already-scheduled microtask and timer callback run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let manager: VcsManager;

beforeEach(() => {
    lore.calls.length = 0;
    lore.release();
    manager = new VcsManager(fakeApp());
});

describe("shutting version control down with the app", () => {
    it("closes every open session, not just the last one", async () => {
        await manager.getInfo(PROJECT);
        await manager.getInfo(OTHER);
        lore.calls.length = 0;

        await manager.dispose();

        expect(lore.calls.filter((call) => call === "closeStore")).toHaveLength(2);
        expect(lore.calls.filter((call) => call === "releaseRepository")).toHaveLength(2);
        expect(manager.openProjects).toEqual([]);
    });

    it("does not return until a call already in flight has finished", async () => {
        // The whole defect in one assertion: a dispose that resolved here would let the quit
        // proceed with a koffi call still on a worker thread.
        const releaseCall = lore.hold();
        const inFlight = manager.getInfo(PROJECT);
        await settle();
        expect(lore.calls).toContain("readBranchIdentity");

        let finished = false;
        const disposal = manager.dispose().then(() => {
            finished = true;
        });
        await settle();

        expect(finished).toBe(false);
        expect(lore.calls).not.toContain("closeStore");

        releaseCall();
        await inFlight;
        await disposal;

        expect(finished).toBe(true);
        expect(lore.calls).toContain("closeStore");
    });

    it("refuses a call that arrives after the drain instead of starting it", async () => {
        await manager.getInfo(PROJECT);
        await manager.dispose();
        lore.calls.length = 0;

        await expect(manager.getInfo(PROJECT)).rejects.toBeInstanceOf(VcsShuttingDownError);
        // Refused, not merely failed: nothing reached the backend, so there is no koffi work to
        // outlive the environment.
        expect(lore.calls).toEqual([]);
    });

    it("stays quiet when a window closes behind the drain", async () => {
        // What the quit actually does: windows close AFTER `before-quit` has drained, and their
        // close handler asks for the same teardown again.
        await manager.getInfo(PROJECT);
        await manager.dispose();
        lore.calls.length = 0;

        await manager.closeProject(PROJECT);

        expect(lore.calls).toEqual([]);
    });
});
