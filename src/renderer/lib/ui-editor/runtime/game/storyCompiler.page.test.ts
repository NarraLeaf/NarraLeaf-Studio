import { describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryDocument, StoryVariableValueType } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { coerceStoryPageResult, type StoryPageHost } from "@/lib/ui-editor/runtime/game/storyPageRow";

/**
 * `/page` rows, compiled: the page the row opens, the story waiting on it, and the answer it writes
 * back into the row's variable.
 */

function pageBlock(id: string, surfaceId: string, resultTarget?: { scope: "scene"; variableId: string }): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "page", surfaceId, ...(resultTarget ? { resultTarget } : {}) },
    };
}

function declaration(id: string, valueType: StoryVariableValueType): StoryBlock {
    return {
        id,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: { scope: "scene", name: id, valueType, defaultValue: valueType === "number" ? 0 : "", storageKey: id },
    } as StoryBlock;
}

function doc(blocks: StoryBlock[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "c1", name: "C", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "S1",
                runtimeName: "S1",
                rootBlockIds: blocks.map(block => block.id),
                blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
            },
        },
    } as unknown as StoryDocument;
}

function hostStub(result: unknown) {
    return {
        open: vi.fn((surfaceId: string) => (surfaceId === "gone" ? null : `layer:${surfaceId}`)),
        wait: vi.fn(async () => result),
        close: vi.fn(),
    } satisfies StoryPageHost;
}

async function compileWith(document: StoryDocument, storyPages?: StoryPageHost) {
    return compileStudioStoryToNlr({
        document,
        sceneId: "scene-1",
        characters: [],
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
        ...(storyPages ? { storyPages } : {}),
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
}

type Compiled = Awaited<ReturnType<typeof compileWith>>;

function rowActions(compiled: Compiled, blockId: string) {
    return compiled.actionIdBindings
        .filter(binding => binding.blockId === blockId)
        .map(binding => binding.action as unknown as { type: string; executeAction(...args: unknown[]): unknown });
}

/** The slice of the engine's game state an awaited row reaches: the storable its result goes into. */
function fakeGameState(writes: Map<string, unknown>) {
    const namespace = {
        get: (key: string) => writes.get(key),
        set: (key: string, value: unknown) => {
            writes.set(key, value);
        },
    };
    const storable = { getNamespace: () => namespace };
    return {
        game: { getLiveGame: () => ({ getStorable: () => storable, storable }) },
        logger: { warn: () => undefined },
        events: { on: () => ({ cancel: () => undefined }) },
    };
}

async function play(compiled: Compiled, blockId: string): Promise<Map<string, unknown>> {
    const writes = new Map<string, unknown>();
    rowActions(compiled, blockId)[0].executeAction(fakeGameState(writes), {});
    await new Promise(resolve => setTimeout(resolve, 0));
    return writes;
}

describe("page rows", () => {
    it("compile to nothing where no story is being played, or with no page named", async () => {
        expect(rowActions(await compileWith(doc([pageBlock("p", "phone")])), "p")).toHaveLength(0);
        expect(rowActions(await compileWith(doc([pageBlock("p", " ")]), hostStub(null)), "p")).toHaveLength(0);
    });

    it("are an action the story waits on, which opens the page and waits for it", async () => {
        const host = hostStub(null);
        const compiled = await compileWith(doc([pageBlock("p", "phone")]), host);
        const actions = rowActions(compiled, "p");
        expect(actions).toHaveLength(1);
        expect(actions[0].type).toBe("service:action");
        await play(compiled, "p");
        expect(host.open).toHaveBeenCalledWith("phone");
        expect(host.wait).toHaveBeenCalledWith("layer:phone");
    });

    it("writes what the page closed with, converted to the variable's type", async () => {
        const host = hostStub("3");
        const compiled = await compileWith(doc([
            declaration("affection", "number"),
            pageBlock("p", "phone", { scope: "scene", variableId: "affection" }),
        ]), host);
        expect([...(await play(compiled, "p")).values()]).toEqual([3]);
    });

    it("writes nothing for a page closed without a result, or one that is gone", async () => {
        const closedEmpty = await compileWith(doc([
            declaration("reply", "string"),
            pageBlock("p", "phone", { scope: "scene", variableId: "reply" }),
        ]), hostStub(null));
        expect((await play(closedEmpty, "p")).size).toBe(0);

        const host = hostStub("yes");
        const gone = await compileWith(doc([
            declaration("reply", "string"),
            pageBlock("p", "gone", { scope: "scene", variableId: "reply" }),
        ]), host);
        expect((await play(gone, "p")).size).toBe(0);
        expect(host.wait).not.toHaveBeenCalled();
    });

    it("reports a result variable the scene does not declare, and still opens the page", async () => {
        const host = hostStub(true);
        const compiled = await compileWith(doc([pageBlock("p", "phone", { scope: "scene", variableId: "gone" })]), host);
        expect(compiled.diagnostics.some(diagnostic => diagnostic.blockId === "p" && diagnostic.level === "error")).toBe(true);
        expect((await play(compiled, "p")).size).toBe(0);
        expect(host.open).toHaveBeenCalledTimes(1);
    });
});

describe("coerceStoryPageResult", () => {
    it("writes nothing for no result", () => {
        expect(coerceStoryPageResult(null, "boolean")).toBeUndefined();
        expect(coerceStoryPageResult(undefined, "string")).toBeUndefined();
    });

    it("reads a result as the variable's own type, and refuses one it cannot", () => {
        expect(coerceStoryPageResult(true, "boolean")).toBe(true);
        expect(coerceStoryPageResult("false", "boolean")).toBe(false);
        expect(coerceStoryPageResult(0, "boolean")).toBe(false);
        expect(coerceStoryPageResult("maybe", "boolean")).toBeUndefined();
        expect(coerceStoryPageResult("4", "number")).toBe(4);
        expect(coerceStoryPageResult(true, "number")).toBe(1);
        expect(coerceStoryPageResult("soon", "number")).toBeUndefined();
        expect(coerceStoryPageResult(2, "string")).toBe("2");
        expect(coerceStoryPageResult({ a: 1 }, "string")).toBe("{\"a\":1}");
        expect(coerceStoryPageResult({ a: [1, "x"] }, "json")).toEqual({ a: [1, "x"] });
    });
});
