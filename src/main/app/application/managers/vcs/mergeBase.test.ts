import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseApp } from "../../baseApp";
import { VcsManager } from "./VcsManager";

const lore = vi.hoisted(() => {
    const calls: string[] = [];
    const currentBranch = new Map([
        ["base", { revision: "base", number: 1, parents: [] }],
        ["mine", { revision: "mine", number: 2, parents: ["base"] }],
    ]);
    const complete = new Map([
        ...currentBranch,
        ["theirs", { revision: "theirs", number: 2, parents: ["base"] }],
    ]);
    const backend = {
        openStore: async () => ({ handleId: 1 }),
        closeStore: async () => undefined,
        flushRepository: async () => undefined,
        releaseRepository: async () => undefined,
        readRepositoryIdentity: async () => ({ repository: "repo0", branch: "main" }),
        readRemote: async () => null,
        readRevisionGraph: async () => currentBranch,
        readMergeGraph: async (_globals: unknown, tips: readonly string[]) => {
            calls.push(`readMergeGraph:${tips.join(",")}`);
            return complete;
        },
        mergeBase: (graph: ReadonlyMap<string, { revision: string }>, a: string, b: string) => {
            calls.push(`mergeBase:${graph.has(b) ? "complete" : "partial"}:${a},${b}`);
            return graph.has(b) ? "base" : undefined;
        },
    };
    return { backend, calls };
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
    lore.calls.length = 0;
    manager = new VcsManager(fakeApp());
});

describe("application merge base", () => {
    it("loads both revision ancestries before answering a cross-branch query", async () => {
        await expect(manager.getMergeBase(PROJECT, "mine", "theirs")).resolves.toBe("base");

        expect(lore.calls).toEqual([
            "readMergeGraph:mine,theirs",
            "mergeBase:complete:mine,theirs",
        ]);
    });
});
