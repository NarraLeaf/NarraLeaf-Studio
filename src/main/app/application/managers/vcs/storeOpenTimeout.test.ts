import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VcsErrorCode } from "@shared/types/vcs";
import type { BaseApp } from "../../baseApp";
import { VcsManager } from "./VcsManager";

/**
 * Opening a repository something else holds must fail, not hang.
 *
 * The backend's lock is exclusive and BLOCKING (docs/version-control.md §4.12): an open against a
 * held repository does not return an error, it does not return at all. Every call is a koffi
 * `async` call on the libuv thread pool, and `fs` runs on that same pool, so four of them stopped
 * the main process from reading any file - which is how "another Studio has this project" used to
 * present: a workspace stuck on "Opening project…" and a window that could not be closed.
 *
 * A fake backend rather than a repository, because the thing under test is a wait: only a fake can
 * hold an open forever on demand and then let it through afterwards.
 */

const lore = vi.hoisted(() => {
    const state = {
        /** Resolves the pending open, so a test can play the other process letting go. */
        release: null as null | ((store: { handleId: number }) => void),
        closed: [] as number[],
        repositoryReleased: 0,
    };
    const backend = {
        openStore: () => new Promise<{ handleId: number }>((resolve) => {
            state.release = resolve;
        }),
        closeStore: async (_globals: unknown, store: { handleId: number }) => {
            state.closed.push(store.handleId);
        },
        releaseRepository: async () => {
            state.repositoryReleased += 1;
        },
        readRepositoryIdentity: async () => ({ repository: "repo0", branch: "main" }),
        readRemote: async () => null,
        readMergeState: async () => ({ inProgress: false, conflicts: [] }),
    };
    return { backend, state };
});

vi.mock("./backend", () => ({
    requireVcsBackend: async () => lore.backend,
    getVcsAvailability: async () => ({ available: true }),
}));

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
    lore.state.release = null;
    lore.state.closed.length = 0;
    lore.state.repositoryReleased = 0;
    vi.useFakeTimers();
    manager = new VcsManager(fakeApp());
});

afterEach(() => {
    vi.useRealTimers();
});

describe("opening a store somebody else holds", () => {
    it("refuses rather than waiting for ever", async () => {
        const call = manager.getMergeState(PROJECT).catch((error: Error) => error);

        await vi.advanceTimersByTimeAsync(2_000);

        const failure = await call;
        expect(failure).toBeInstanceOf(Error);
        // Named, because the backend produces no message at all for this - from its side nothing
        // has failed yet - and the interface has to be able to say the situation in the reader's
        // language.
        expect((failure as Error & { code?: string }).code).toBe(VcsErrorCode.RepositoryLocked);
    });

    it("gives back a handle that arrives after the wait was given up", async () => {
        const call = manager.getMergeState(PROJECT).catch(() => undefined);
        await vi.advanceTimersByTimeAsync(2_000);
        await call;

        // The other process let go, and the open this one had stopped waiting for finally landed.
        // Nothing references the handle, so leaving it open would hold the repository - exclusively
        // - for the rest of this process's life.
        lore.state.release?.({ handleId: 7 });
        await vi.advanceTimersByTimeAsync(0);

        expect(lore.state.closed).toEqual([7]);
        expect(lore.state.repositoryReleased).toBe(1);
    });

    it("opens normally when the repository is free", async () => {
        const call = manager.getMergeState(PROJECT);
        // The open is several awaits down; nothing has reached the backend until they have run.
        await vi.advanceTimersByTimeAsync(0);
        lore.state.release?.({ handleId: 1 });

        await expect(call).resolves.toEqual({ inProgress: false, conflicts: [] });
        // Nothing was abandoned, so nothing is handed back.
        expect(lore.state.closed).toEqual([]);
    });
});
