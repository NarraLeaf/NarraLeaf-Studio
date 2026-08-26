import { describe, expect, it } from "vitest";
import { Story } from "narraleaf-react";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { collectStoryPlaybackPlan } from "@/lib/ui-editor/runtime/game/storyPlaybackWalk";

/**
 * What `/jump ... return` compiles to, and what a plain `/jump` still compiles to.
 *
 * The engine builds a returnable jump out of different actions (`scene:preSuspend` / `scene:callTo`
 * / `scene:resume` rather than `scene:preUnmount` / `scene:exit` / `scene:jumpTo`), so the row's flag
 * is checked here against the actions that actually reach the story rather than against the payload
 * that was handed in.
 */

function narrationBlock(id: string, value: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `${id}-t`, value, role: "narration" } },
    } as StoryBlock;
}

function jumpBlock(id: string, targetSceneId: string, returnable?: true): StoryBlock {
    return {
        id,
        kind: "jump",
        parentId: null,
        childrenIds: [],
        payload: { targetSceneId, ...(returnable ? { returnable: true } : {}) },
    };
}

function document(jump: StoryBlock, trailing: StoryBlock[] = []): StoryDocument {
    const sceneOneBlocks = [narrationBlock("a1", "Before."), jump, ...trailing];
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [],
        entrySceneId: "scene-1",
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Prologue",
                runtimeName: "scene-1",
                rootBlockIds: sceneOneBlocks.map(block => block.id),
                blocks: Object.fromEntries(sceneOneBlocks.map(block => [block.id, block])),
            },
            "scene-2": {
                id: "scene-2",
                name: "Title card",
                runtimeName: "scene-2",
                rootBlockIds: ["b1"],
                blocks: { b1: narrationBlock("b1", "A title.") },
            },
        },
    } as unknown as StoryDocument;
}

/** Every action type the compiled story holds, target scenes included. */
async function compiledActionTypes(doc: StoryDocument): Promise<string[]> {
    const compiled = await compileStudioStoryToNlr({
        document: doc,
        sceneId: "scene-1",
        characters: [],
        resolveAssetUrl: async assetId => `nlr://${assetId}`,
    });
    expect(compiled.diagnostics).toEqual([]);

    // Both are `@internal`, so `stripInternal` takes them out of the shipped declarations - the
    // structural cast is how a test reaches the walk the engine itself constructs a story with.
    const story = new Story("t").entry(compiled.scene) as unknown as { constructStory: () => void };
    story.constructStory();
    const scene = compiled.scene as unknown as {
        getAllChildren: (story: unknown, root: unknown, options: { allowFutureScene: boolean }) => { type: string }[];
        getSceneRoot: () => unknown;
    };
    return scene.getAllChildren(story, scene.getSceneRoot(), { allowFutureScene: true }).map(action => action.type);
}

describe("a plain jump compiles to what it always compiled to", () => {
    it("emits preUnmount / exit / jumpTo and nothing of the call machinery", async () => {
        const types = await compiledActionTypes(document(jumpBlock("j", "scene-2")));

        expect(types).toContain("scene:preUnmount");
        expect(types).toContain("scene:exit");
        expect(types).toContain("scene:jumpTo");
        expect(types).not.toContain("scene:callTo");
        expect(types).not.toContain("scene:resume");
        expect(types).not.toContain("scene:preSuspend");
    });
});

describe("a returnable jump compiles to a call", () => {
    it("emits preSuspend / callTo / resume and neither preUnmount nor exit", async () => {
        const types = await compiledActionTypes(document(jumpBlock("j", "scene-2", true)));

        expect(types).toContain("scene:preSuspend");
        expect(types).toContain("scene:callTo");
        expect(types).toContain("scene:resume");
        expect(types).not.toContain("scene:preUnmount");
        expect(types).not.toContain("scene:exit");
        expect(types).not.toContain("scene:jumpTo");
    });

    it("keeps the transition the row asks for", async () => {
        const doc = document({
            id: "j",
            kind: "jump",
            parentId: null,
            childrenIds: [],
            payload: { targetSceneId: "scene-2", returnable: true, transition: { kind: "fadeIn", durationMs: 120 } },
        });
        const types = await compiledActionTypes(doc);

        expect(types).toContain("scene:transitionToScene");
        expect(types).toContain("scene:callTo");
    });

    it("compiles the rows written after it, because the run comes back to them", async () => {
        const doc = document(jumpBlock("j", "scene-2", true), [narrationBlock("a2", "After.")]);
        const compiled = await compileStudioStoryToNlr({
            document: doc,
            sceneId: "scene-1",
            characters: [],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toEqual(expect.arrayContaining(["a1", "j", "a2"]));
    });
});

describe("the playback walk", () => {
    const sceneOf = (doc: StoryDocument) => doc.scenes["scene-1"];

    it("carries on past a returnable jump when it is following jumps", () => {
        const doc = document(jumpBlock("j", "scene-2", true), [narrationBlock("a2", "After.")]);
        const plan = collectStoryPlaybackPlan(sceneOf(doc), null, { followJumps: true });

        expect(plan.steps.map(step => step.blockId)).toEqual(["a1", "j", "a2"]);
        expect(plan.stop).toEqual({ reason: "sceneEnd" });
    });

    it("still stops at a plain jump when it is following jumps", () => {
        const doc = document(jumpBlock("j", "scene-2"), [narrationBlock("a2", "After.")]);
        const plan = collectStoryPlaybackPlan(sceneOf(doc), null, { followJumps: true });

        expect(plan.steps.map(step => step.blockId)).toEqual(["a1", "j"]);
        expect(plan.stop).toMatchObject({ reason: "jump", blockId: "j" });
    });

    it("holds before a returnable jump in the single-scene preview", () => {
        // The preview compiles one scene, so the scene being called is not in the story it built and
        // there is nothing to come back from.
        const doc = document(jumpBlock("j", "scene-2", true), [narrationBlock("a2", "After.")]);
        const plan = collectStoryPlaybackPlan(sceneOf(doc), null);

        expect(plan.steps.map(step => step.blockId)).toEqual(["a1"]);
        expect(plan.stop).toMatchObject({ reason: "jump", blockId: "j" });
    });
});

describe("a returnable jump the compiler cannot make ordinary sense of", () => {
    it("compiles a call to a scene with no rows in it", async () => {
        // An empty called scene returns the instant it is entered. Nothing about that is a diagnostic
        // - an author writes the scene before its content - and the row after the call still has to
        // be compiled, or filling the scene in later would leave the return landing on nothing.
        const doc = document(jumpBlock("j", "scene-empty", true), [narrationBlock("a2", "After.")]);
        const withEmpty = {
            ...doc,
            scenes: {
                ...doc.scenes,
                "scene-empty": { id: "scene-empty", name: "Nothing yet", runtimeName: "scene-empty", rootBlockIds: [], blocks: {} },
            },
        } as unknown as StoryDocument;

        const compiled = await compileStudioStoryToNlr({
            document: withEmpty,
            sceneId: "scene-1",
            characters: [],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toEqual(expect.arrayContaining(["j", "a2"]));
    });

    it("reports a call naming a scene the document does not have, exactly as a plain jump is reported", async () => {
        const doc = document(jumpBlock("j", "scene-gone", true), [narrationBlock("a2", "After.")]);
        const compiled = await compileStudioStoryToNlr({
            document: doc,
            sceneId: "scene-1",
            characters: [],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        expect(compiled.diagnostics.map(entry => entry.blockId)).toEqual(["j"]);
    });
});

describe("the playback walk launched from each row around a call", () => {
    const doc = () => document(jumpBlock("j", "scene-2", true), [narrationBlock("a2", "After."), narrationBlock("a3", "Last.")]);

    it("launched at the call row, plays the call and everything after it", () => {
        const plan = collectStoryPlaybackPlan(doc().scenes["scene-1"], "j", { followJumps: true });

        expect(plan.steps.map(step => step.blockId)).toEqual(["j", "a2", "a3"]);
        expect(plan.stop).toEqual({ reason: "sceneEnd" });
    });

    it("launched at the row after the call, plays from there and does not re-enter the call", () => {
        const plan = collectStoryPlaybackPlan(doc().scenes["scene-1"], "a2", { followJumps: true });

        expect(plan.steps.map(step => step.blockId)).toEqual(["a2", "a3"]);
        expect(plan.stop).toEqual({ reason: "sceneEnd" });
    });

    it("launched at a row inside the called scene, plays that scene and stops at its end", () => {
        // A launch is not a resume: nothing called this scene, so there is no caller to come back to
        // and the tail is the scene's own remaining rows.
        const plan = collectStoryPlaybackPlan(doc().scenes["scene-2"], "b1", { followJumps: true });

        expect(plan.steps.map(step => step.blockId)).toEqual(["b1"]);
        expect(plan.stop).toEqual({ reason: "sceneEnd" });
    });

    it("carries on past a call written as the last row, because the scene really does end there", () => {
        const plan = collectStoryPlaybackPlan(document(jumpBlock("j", "scene-2", true)).scenes["scene-1"], null, { followJumps: true });

        expect(plan.steps.map(step => step.blockId)).toEqual(["a1", "j"]);
        expect(plan.stop).toEqual({ reason: "sceneEnd" });
    });
});
