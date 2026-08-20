import { afterEach, describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStagePreviewToNlr, compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { computeStoryStageSnapshot } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import {
    clearStoryCompilePasses,
    registerStoryCompilePass,
    type CompileBlockView,
} from "@/lib/ui-editor/runtime/game/storyCompilePass";

/**
 * The plugin compile-pass seam, end to end: a registered pass runs once per scene during a game
 * compile, sees the scene's rows in execution order in its own four-kind vocabulary, and can build
 * and attach engine actions around them.
 *
 * The preview case has a test of its own because it is the one that fails quietly. A stage preview
 * answers "what does the stage look like at this row"; if a pass ran there, the author would be
 * shown darkness their row does not describe and would go looking for it in their own document.
 */

afterEach(() => clearStoryCompilePasses());

function characterEnter(id: string, characterId: string, objectName?: string): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "character", operation: "enter", characterId, ...(objectName ? { objectName } : {}) },
    } as StoryBlock;
}

function dialogue(id: string, characterId: string | undefined, value: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: characterId ? "dialogue" : "narration",
            ...(characterId ? { characterId } : {}),
            text: { textId: `t-${id}`, value, role: characterId ? "dialogue" : "narration" },
        },
    } as StoryBlock;
}

function pluginBlock(id: string, actionId: string, params: Record<string, unknown> = {}): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "plugin", pluginId: "test.plugin", actionId, params },
    } as StoryBlock;
}

function waitBlock(id: string): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "wait", mode: "duration", durationMs: 50 },
    } as StoryBlock;
}

function doc(blocks: Record<string, StoryBlock>, rootBlockIds: string[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "c1", name: "C", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": { id: "scene-1", name: "S1", runtimeName: "S1", rootBlockIds, blocks },
        },
    } as unknown as StoryDocument;
}

const CHARACTERS = [
    {
        id: "char-alice",
        name: "Alice",
        appearance: { kind: "preset", poses: [{ id: "pose-base", name: "base", assetId: "asset-alice" }], defaultPoseId: "pose-base" },
    },
    {
        id: "char-bob",
        name: "Bob",
        appearance: { kind: "preset", poses: [{ id: "pose-base", name: "base", assetId: "asset-bob" }], defaultPoseId: "pose-base" },
    },
];

async function compileWith(document: StoryDocument) {
    return compileStudioStoryToNlr({
        document,
        sceneId: "scene-1",
        characters: CHARACTERS as never,
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
}

describe("story compile pass", () => {
    it("runs once per scene and classifies rows in execution order", async () => {
        const seen: CompileBlockView[][] = [];
        registerStoryCompilePass({ id: "test.plugin", scene: ctx => { seen.push([...ctx.blocks]); } }, "test.plugin");

        const blocks: Record<string, StoryBlock> = {
            enterA: characterEnter("enterA", "char-alice", "alice"),
            enable: pluginBlock("enable", "test.plugin.enable"),
            sayA: dialogue("sayA", "char-alice", "hi"),
            narr: dialogue("narr", undefined, "the room is quiet"),
            wait: waitBlock("wait"),
        };
        await compileWith(doc(blocks, ["enterA", "enable", "sayA", "narr", "wait"]));

        expect(seen).toHaveLength(1);
        expect(seen[0]).toEqual([
            { kind: "other", id: "enterA" },
            { kind: "pluginAction", id: "enable", pluginId: "test.plugin", actionId: "test.plugin.enable", params: {} },
            { kind: "dialogue", id: "sayA", speaker: "alice" },
            { kind: "dialogue", id: "narr", speaker: null },
            { kind: "other", id: "wait" },
        ]);
    });

    it("skips disabled rows, so the pass sees the order that will actually run", async () => {
        const seen: CompileBlockView[][] = [];
        registerStoryCompilePass({ id: "test.plugin", scene: ctx => { seen.push([...ctx.blocks]); } }, "test.plugin");

        const skipped = { ...dialogue("sayB", "char-bob", "cut"), disabled: true } as StoryBlock;
        const blocks: Record<string, StoryBlock> = {
            sayA: dialogue("sayA", "char-alice", "hi"),
            sayB: skipped,
        };
        await compileWith(doc(blocks, ["sayA", "sayB"]));

        expect(seen[0].map(view => view.id)).toEqual(["sayA"]);
    });

    it("exposes the roster and resolves only characters this scene mentions", async () => {
        let roster: string[] = [];
        let aliceResolved = false;
        let ghostResolved = true;
        registerStoryCompilePass({
            id: "test.plugin",
            scene: ctx => {
                roster = ctx.roster().sort();
                aliceResolved = ctx.resolveCharacterImage("alice") !== null;
                ghostResolved = ctx.resolveCharacterImage("ghost") !== null;
            },
        }, "test.plugin");

        const blocks: Record<string, StoryBlock> = {
            enterA: characterEnter("enterA", "char-alice", "alice"),
            enterB: characterEnter("enterB", "char-bob", "bob"),
            sayA: dialogue("sayA", "char-alice", "hi"),
        };
        await compileWith(doc(blocks, ["enterA", "enterB", "sayA"]));

        expect(roster).toEqual(["alice", "bob"]);
        expect(aliceResolved).toBe(true);
        // Not in this scene: null rather than an image nothing on stage answers to.
        expect(ghostResolved).toBe(false);
    });

    it("splices injected actions around the row, and a marker row carries its own", async () => {
        registerStoryCompilePass({
            id: "test.plugin",
            scene: ctx => {
                const flag = ctx.runtimeFlag("test.plugin:enabled");
                for (const view of ctx.blocks) {
                    if (view.kind === "pluginAction") {
                        ctx.inject(view.id, { after: [flag.write(true)] });
                    }
                    if (view.kind === "dialogue" && view.speaker) {
                        const darkens = ctx.roster()
                            .map(name => ctx.resolveCharacterImage(name))
                            .filter((image): image is NonNullable<typeof image> => image !== null)
                            .map(image => image.darken(0.5, 300, "easeOut"));
                        ctx.inject(view.id, { before: [ctx.guarded(flag, [ctx.parallel(darkens)])] });
                    }
                }
            },
        }, "test.plugin");

        const blocks: Record<string, StoryBlock> = {
            enterA: characterEnter("enterA", "char-alice", "alice"),
            enterB: characterEnter("enterB", "char-bob", "bob"),
            enable: pluginBlock("enable", "test.plugin.enable"),
            sayA: dialogue("sayA", "char-alice", "hi"),
        };
        const compiled = await compileWith(doc(blocks, ["enterA", "enterB", "enable", "sayA"]));

        expect(compiled.story).toBeTruthy();
        expect(compiled.diagnostics.filter(entry => entry.level === "error")).toHaveLength(0);
    });

    it("a marker row whose plugin registered nothing compiles to nothing, without a diagnostic", async () => {
        const blocks: Record<string, StoryBlock> = {
            enable: pluginBlock("enable", "absent.plugin.enable"),
            sayA: dialogue("sayA", "char-alice", "hi"),
        };
        const compiled = await compileWith(doc(blocks, ["enable", "sayA"]));

        expect(compiled.diagnostics.filter(entry => entry.level === "error")).toHaveLength(0);
        expect(compiled.diagnostics.filter(entry => entry.level === "warning")).toHaveLength(0);
    });

    it("keeps compiling when a pass throws, and says which one failed", async () => {
        registerStoryCompilePass({
            id: "test.plugin",
            scene: () => { throw new Error("pass exploded"); },
        }, "test.plugin");

        const compiled = await compileWith(doc({ sayA: dialogue("sayA", "char-alice", "hi") }, ["sayA"]));

        expect(compiled.story).toBeTruthy();
        expect(compiled.diagnostics.filter(entry => entry.level === "error")).toHaveLength(0);
        expect(compiled.diagnostics.some(entry => entry.message.includes("test.plugin") && entry.message.includes("pass exploded"))).toBe(true);
    });

    it("does not run passes on the stage preview path", async () => {
        let ran = 0;
        registerStoryCompilePass({ id: "test.plugin", scene: () => { ran += 1; } }, "test.plugin");

        const document = doc({
            enterA: characterEnter("enterA", "char-alice", "alice"),
            sayA: dialogue("sayA", "char-alice", "hi"),
        }, ["enterA", "sayA"]);
        const snapshot = computeStoryStageSnapshot({ document, sceneId: "scene-1", targetBlockId: "sayA" });
        await compileStagePreviewToNlr({
            document,
            sceneId: "scene-1",
            snapshot,
            targetBlockId: "sayA",
            characters: CHARACTERS as never,
            resolveAssetUrl: (assetId: string) => `test://${assetId}`,
            onBeforeTarget: () => {},
            onAfterTarget: () => {},
        } as Parameters<typeof compileStagePreviewToNlr>[0]);

        expect(ran).toBe(0);
    });

    it("ignores a duplicate pass id, so a setup that runs twice does not inject twice", async () => {
        let ran = 0;
        const pass = { id: "test.plugin", scene: () => { ran += 1; } };
        registerStoryCompilePass(pass, "test.plugin");
        registerStoryCompilePass(pass, "test.plugin");
        await compileWith(doc({ sayA: dialogue("sayA", "char-alice", "hi") }, ["sayA"]));
        expect(ran).toBe(1);
    });
});
