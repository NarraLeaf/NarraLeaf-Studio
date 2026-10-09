import { describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryDocument, StoryInputActionPayload } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION, STORY_RUMBLE_PRESETS } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import type { StoryInputHost } from "@/lib/ui-editor/runtime/input/storyInputHost";

/**
 * The player's-hands rows, compiled: what each one hands the host, and the one place a row writes
 * back into the story - a waiting row's result variable.
 */

function inputBlock(id: string, payload: StoryInputActionPayload): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload };
}

function declaration(id: string): StoryBlock {
    return {
        id,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: { scope: "scene", name: id, valueType: "boolean", defaultValue: false, storageKey: id },
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

function hostStub(passed = true) {
    return {
        rumble: vi.fn(async () => undefined),
        stopRumble: vi.fn(),
        setAdvanceLocked: vi.fn(),
        isAdvanceLocked: vi.fn(() => false),
        waitForInput: vi.fn(async () => passed),
    } satisfies StoryInputHost;
}

async function compileWith(document: StoryDocument, storyInput?: StoryInputHost) {
    return compileStudioStoryToNlr({
        document,
        sceneId: "scene-1",
        characters: [],
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
        ...(storyInput ? { storyInput } : {}),
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
}

type Compiled = Awaited<ReturnType<typeof compileWith>>;

function rowActions(compiled: Compiled, blockId: string) {
    return compiled.actionIdBindings
        .filter(binding => binding.blockId === blockId)
        .map(binding => binding.action as unknown as { type: string; executeAction(...args: unknown[]): unknown });
}

describe("input rows", () => {
    it("compile to nothing where no story is being played", async () => {
        const compiled = await compileWith(doc([
            inputBlock("rumble", { action: "input", operation: "rumble", preset: "impact" }),
            inputBlock("lock", { action: "input", operation: "lock" }),
            inputBlock("wait", { action: "input", operation: "wait", actionId: "confirm" }),
        ]));
        expect(rowActions(compiled, "rumble")).toHaveLength(0);
        expect(rowActions(compiled, "lock")).toHaveLength(0);
        expect(rowActions(compiled, "wait")).toHaveLength(0);
    });

    it("a waiting rumble and every wait are actions the story waits on", async () => {
        const host = hostStub();
        const compiled = await compileWith(doc([
            inputBlock("rumble", { action: "input", operation: "rumble", preset: "impact", wait: true }),
            inputBlock("wait", { action: "input", operation: "wait", actionId: "confirm", timeoutMs: 2000 }),
            inputBlock("hold", { action: "input", operation: "hold", holdMs: 1500 }),
            inputBlock("mash", { action: "input", operation: "mash", actionId: "confirm", count: 5 }),
        ]), host);
        for (const id of ["rumble", "wait", "hold", "mash"]) {
            const actions = rowActions(compiled, id);
            expect(actions).toHaveLength(1);
            expect(actions[0].type).toBe("service:action");
        }
    });

    it("hands the host the resolved rumble and the wait request", async () => {
        const host = hostStub();
        const compiled = await compileWith(doc([
            inputBlock("rumble", { action: "input", operation: "rumble", preset: "impact", durationMs: 400, wait: true }),
            inputBlock("mash", { action: "input", operation: "mash", actionId: "confirm", count: 5, timeoutMs: 3000 }),
        ]), host);
        const gameState = fakeGameState(new Map());
        rowActions(compiled, "rumble")[0].executeAction(gameState, {});
        rowActions(compiled, "mash")[0].executeAction(gameState, {});
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(host.rumble).toHaveBeenCalledWith(
            { ...STORY_RUMBLE_PRESETS.impact, durationMs: 400 },
            expect.objectContaining({ wait: true }),
        );
        expect(host.waitForInput).toHaveBeenCalledWith(
            { operation: "mash", actionId: "confirm", count: 5, timeoutMs: 3000 },
            expect.any(AbortSignal),
        );
    });

    it("writes the outcome into the row's boolean variable", async () => {
        const host = hostStub(false);
        const compiled = await compileWith(doc([
            declaration("dodged"),
            inputBlock("wait", {
                action: "input",
                operation: "wait",
                timeoutMs: 1000,
                resultTarget: { scope: "scene", variableId: "dodged" },
            }),
        ]), host);
        const writes = new Map<string, unknown>();
        rowActions(compiled, "wait")[0].executeAction(fakeGameState(writes), {});
        await new Promise(resolve => setTimeout(resolve, 0));
        expect([...writes.values()]).toEqual([false]);
    });

    it("reports a result variable the scene does not declare", async () => {
        const compiled = await compileWith(doc([
            inputBlock("wait", { action: "input", operation: "wait", resultTarget: { scope: "scene", variableId: "gone" } }),
        ]), hostStub());
        expect(compiled.diagnostics.some(diagnostic => diagnostic.blockId === "wait" && diagnostic.level === "error")).toBe(true);
        expect(rowActions(compiled, "wait")).toHaveLength(0);
    });
});

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
    };
}
