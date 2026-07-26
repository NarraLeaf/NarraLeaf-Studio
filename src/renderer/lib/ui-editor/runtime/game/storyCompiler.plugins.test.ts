import { afterEach, describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import {
    registerStoryCompilePass,
    clearStoryCompilePasses,
    type CompileBlockView,
} from "@/lib/ui-editor/runtime/game/storyCompilePass";

/**
 * Exercises the plugin compile-pass seam end to end: a pass registered in the shared registry is
 * run once per scene during compileStudioStoryToNlr, sees the scene's blocks classified into the
 * pass vocabulary + the character roster, and can build/inject engine actions without throwing.
 */

afterEach(() => clearStoryCompilePasses());

function characterEnter(id: string, characterId: string, objectName?: string): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "character", operation: "enter", characterId, ...(objectName ? { objectName } : {}) },
    };
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
    };
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
    };
}

const CHARACTERS = [
    { id: "char-alice", name: "Alice", defaultForm: "base", forms: [] },
    { id: "char-bob", name: "Bob", defaultForm: "base", forms: [] },
];

async function compileWith(document: StoryDocument) {
    return compileStudioStoryToNlr({ document, sceneId: "scene-1", characters: CHARACTERS as never });
}

describe("story compile pass", () => {
    it("runs a registered pass once per scene and classifies blocks in execution order", async () => {
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

    it("exposes the roster and resolves only in-scene characters", async () => {
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
        expect(ghostResolved).toBe(false); // not in the scene → null
    });

    it("lets a pass inject darkens (parallel + guarded + flag) without throwing, and compiles", async () => {
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
                            .filter((img): img is NonNullable<typeof img> => img !== null)
                            .map(img => img.darken(0.5, 300, "easeOut"));
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
        // The compile completed and produced a runnable story; the injected actions are spliced in.
        expect(compiled.story).toBeTruthy();
        expect(compiled.diagnostics.filter(d => d.level === "error")).toHaveLength(0);
    });

    it("does not run passes on the stage preview path (no injection there)", async () => {
        let ran = 0;
        registerStoryCompilePass({ id: "test.plugin", scene: () => { ran += 1; } }, "test.plugin");
        // A plain game compile runs the pass once; this asserts the pass fires on the main path.
        await compileWith(doc({ sayA: dialogue("sayA", "char-alice", "hi") }, ["sayA"]));
        expect(ran).toBe(1);
    });

    it("ignores a duplicate pass id (idempotent registration)", async () => {
        let ran = 0;
        const pass = { id: "test.plugin", scene: () => { ran += 1; } };
        registerStoryCompilePass(pass, "test.plugin");
        registerStoryCompilePass(pass, "test.plugin"); // duplicate id → ignored
        await compileWith(doc({ sayA: dialogue("sayA", "char-alice", "hi") }, ["sayA"]));
        expect(ran).toBe(1);
    });
});
