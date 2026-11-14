import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    WORD_COUNT_BASIS,
    createEmptyProjectStats,
    toActivityDayKey,
    type ProjectStatsV1,
} from "@shared/types/stats";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import { Services, type WorkspaceContext } from "../services";
import { ProjectStatsService } from "./ProjectStatsService";

const globalState = vi.hoisted(() => ({
    listeners: new Set<(change: { key: string; value: unknown }) => void>(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: { state: {
            onGlobalStateChanged: (listener: (change: { key: string; value: unknown }) => void) => {
                globalState.listeners.add(listener);
                return { cancel: () => globalState.listeners.delete(listener) };
            },
        } },
    }),
}));

const NOW = new Date(2026, 10, 14, 12);

function storyDocument(text: string): StoryDocument {
    const block = {
        id: "line", kind: "nodeAction", parentId: null, childrenIds: [],
        payload: { action: "narration", text: { textId: "text", role: "narration", value: text } },
    } as StoryBlock;
    const scene = {
        id: "scene", name: "Scene", runtimeName: "scene", rootBlockIds: [block.id], blocks: { [block.id]: block },
    } as StoryScene;
    return { chapters: [], scenes: { [scene.id]: scene } } as unknown as StoryDocument;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function previousStats(): ProjectStatsV1 {
    const stats = createEmptyProjectStats();
    stats.wordBasis = WORD_COUNT_BASIS - 1;
    stats.days[toActivityDayKey(NOW.getTime() - 86_400_000)] = { words: 20, edits: 1, activeSeconds: 60 };
    return stats;
}

function makeHarness(stored: ProjectStatsV1) {
    const get = vi.fn(async (_key: string): Promise<unknown> => stored);
    const writes: ProjectStatsV1[] = [];
    const set = vi.fn(async (_key: string, value: ProjectStatsV1) => {
        writes.push(JSON.parse(JSON.stringify(value)) as ProjectStatsV1);
    });
    const story = {
        listStories: vi.fn(() => [{ id: "one" }]),
        loadStory: vi.fn(async (_id: string): Promise<StoryDocument> => storyDocument("𠀀𠀀")),
        getRevision: (): number => 0,
        onDocumentChanged: (_handler: () => void): (() => void) => () => undefined,
    };
    const stubs: Record<string, unknown> = {
        [Services.Project]: { getProjectConfig: () => ({ identifier: "com.example.game" }) },
        [Services.GlobalSettings]: { get, set },
        [Services.Story]: story,
    };
    const ctx = {
        project: { getConfig: () => ({ projectPath: "/project" }) },
        commandLineRun: false,
        services: { get: (id: string) => {
            if (!(id in stubs)) throw new Error(`Service ${id} not found`);
            return stubs[id];
        } },
    } as unknown as WorkspaceContext;
    return { ctx, get, writes, story, service: new ProjectStatsService() };
}

describe("ProjectStatsService word counts", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        globalState.listeners.clear();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        globalState.listeners.clear();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("keeps the old basis until every story can be counted, then records a rebase", async () => {
        const h = makeHarness(previousStats());
        let unavailable = true;
        h.story.listStories.mockReturnValue([{ id: "one" }, { id: "two" }]);
        h.story.loadStory.mockImplementation(async id => {
            if (id === "two" && unavailable) throw new Error("story unavailable");
            return storyDocument("𠀀𠀀");
        });
        await h.service.initialize(h.ctx, async () => undefined);
        await vi.advanceTimersByTimeAsync(10_000);

        expect(h.service.getStats().wordBasis).toBe(WORD_COUNT_BASIS - 1);
        expect(h.service.getStats().days[toActivityDayKey(NOW.getTime())]).toBeUndefined();

        await h.service.teardown(h.ctx);
        h.get.mockResolvedValue(h.service.getStats());
        unavailable = false;
        await h.service.initialize(h.ctx, async () => undefined);
        await vi.advanceTimersByTimeAsync(12_000);

        expect(h.service.getStats().wordBasis).toBe(WORD_COUNT_BASIS);
        expect(h.service.getStats().days[toActivityDayKey(NOW.getTime())]).toMatchObject({ words: 4, rebased: true });
        expect(h.writes.at(-1)).toMatchObject({ wordBasis: WORD_COUNT_BASIS });
        expect(h.writes.at(-1)?.days[toActivityDayKey(NOW.getTime())]).toMatchObject({ words: 4, rebased: true });
        await h.service.teardown(h.ctx);
    });

    it("does not restore an in-flight recount after clearing this project's statistics", async () => {
        const h = makeHarness(previousStats());
        const read = deferred<StoryDocument>();
        h.story.loadStory.mockReturnValue(read.promise);
        await h.service.initialize(h.ctx, async () => undefined);
        await vi.advanceTimersByTimeAsync(10_000);

        await h.service.clear();
        read.resolve(storyDocument("𠀀𠀀"));
        await vi.advanceTimersByTimeAsync(2_000);

        expect(h.service.getStats().days).toEqual({});
        expect(h.writes.at(-1)?.days).toEqual({});
        await h.service.teardown(h.ctx);
    });

    it("does not restore an in-flight recount after an external statistics reset", async () => {
        const h = makeHarness(previousStats());
        const read = deferred<StoryDocument>();
        h.story.loadStory.mockReturnValue(read.promise);
        await h.service.initialize(h.ctx, async () => undefined);
        await vi.advanceTimersByTimeAsync(10_000);
        const key = h.get.mock.calls[0][0];

        for (const listener of globalState.listeners) listener({ key, value: createEmptyProjectStats() });
        read.resolve(storyDocument("𠀀𠀀"));
        await vi.advanceTimersByTimeAsync(2_000);

        expect(h.service.getStats().days).toEqual({});
        expect(h.service.getStats().wordBasis).toBe(WORD_COUNT_BASIS);
        await h.service.teardown(h.ctx);
    });

    it("does not persist a recount that finishes after a newer recount", async () => {
        const h = makeHarness(createEmptyProjectStats());
        const first = deferred<StoryDocument>();
        const second = deferred<StoryDocument>();
        h.story.loadStory.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        let editStory!: () => void;
        let revision = 0;
        h.story.getRevision = () => revision;
        h.story.onDocumentChanged = handler => { editStory = handler; return () => undefined; };
        const service = h.service;
        await service.initialize(h.ctx, async () => undefined);
        await vi.advanceTimersByTimeAsync(10_000);
        (service as unknown as { markInteraction: () => void }).markInteraction();
        revision += 1;
        editStory();
        await vi.advanceTimersByTimeAsync(15_000);

        second.resolve(storyDocument("𠀀𠀀𠀀"));
        await vi.advanceTimersByTimeAsync(0);
        first.resolve(storyDocument("𠀀𠀀"));
        await vi.advanceTimersByTimeAsync(2_000);

        expect(service.getStats().days[toActivityDayKey(NOW.getTime())].words).toBe(3);
        expect(h.writes.at(-1)?.days[toActivityDayKey(NOW.getTime())].words).toBe(3);
        await service.teardown(h.ctx);
    });
});
