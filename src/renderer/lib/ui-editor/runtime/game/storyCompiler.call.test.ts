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

/**
 * A returnable jump inside a group, which is where the call used to come apart.
 *
 * `Control.all` / `any` / `allAsync` / `repeat` / `whileLoop` hand the engine a flat body and run one
 * concurrent branch per action in it, where `Control.do` / `doAsync` link theirs into a single run.
 * That is invisible for a row that compiles to one action, and fatal for the one row that does not: a
 * returnable jump is three actions - the `control:do` that enters the target, `scene:callTo`, and
 * the `scene:resume` linked behind it that IS the call's return address - so as three branches the
 * call had nothing behind it and the engine stopped the game with "A scene call has no return
 * address." What is pinned below is that the call reaches those groups as ONE branch, and that no
 * other row's body moved.
 */

type ContentNodeLike = { action: ActionLike | null; getChild: () => ContentNodeLike | null };
type ActionLike = { type: string; contentNode: ContentNodeLike & { getContent: () => unknown[] } };

/** A control group holding the given rows, as the only row of scene 1. */
function groupDocument(payload: StoryBlock["payload"], children: StoryBlock[]): StoryDocument {
    const group = {
        id: "g",
        kind: "control",
        parentId: null,
        childrenIds: children.map(child => child.id),
        payload,
    } as StoryBlock;
    const nested = children.map(child => ({ ...child, parentId: "g" }) as StoryBlock);
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
                rootBlockIds: ["g"],
                blocks: Object.fromEntries([[group.id, group], ...nested.map(child => [child.id, child])]),
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

/** Every action one row compiled to, in the order the row emitted them. */
async function actionsOfRow(doc: StoryDocument, blockId: string): Promise<ActionLike[]> {
    const compiled = await compileStudioStoryToNlr({
        document: doc,
        sceneId: "scene-1",
        characters: [],
        resolveAssetUrl: async assetId => `nlr://${assetId}`,
    });
    expect(compiled.diagnostics).toEqual([]);
    return compiled.actionIdBindings
        .filter(binding => binding.blockId === blockId)
        .map(binding => binding.action as unknown as ActionLike);
}

/** The single action the group row compiled to. */
async function groupActionOf(doc: StoryDocument): Promise<ActionLike> {
    const actions = await actionsOfRow(doc, "g");
    expect(actions).toHaveLength(1);
    return actions[0];
}

/**
 * The body a control action holds. Chained or not, the action array is the first item of the content
 * node; a `repeat`'s count and a `whileLoop`'s lambda ride after it.
 */
function bodyOf(action: ActionLike): ActionLike[] {
    return action.contentNode.getContent()[0] as ActionLike[];
}

/** The action types reachable from one action by following the links a chained body is built from. */
function runFrom(action: ActionLike): string[] {
    const types: string[] = [];
    let node: ContentNodeLike | null = action.contentNode;
    while (node && types.length < 32) {
        if (node.action) {
            types.push(node.action.type);
        }
        node = node.getChild();
    }
    return types;
}

/** What a returnable jump compiles to, in order. */
const CALL_CHAIN = ["control:do", "scene:callTo", "scene:resume"];

describe("a returnable jump inside a group the engine stores unchained", () => {
    const groups: [string, StoryBlock["payload"]][] = [
        ["parallel", { control: "parallel", mode: "all" } as StoryBlock["payload"]],
        ["race", { control: "race", mode: "any" } as StoryBlock["payload"]],
        ["a counted repeat", { control: "repeat", times: 2 } as StoryBlock["payload"]],
        [
            "a repeat until",
            {
                control: "repeat",
                until: { kind: "expression", expression: { source: "false", ast: { kind: "literal", value: false } } },
            } as StoryBlock["payload"],
        ],
    ];

    it.each(groups)("reaches %s as one branch holding the whole call chain", async (_name, payload) => {
        const group = await groupActionOf(groupDocument(payload, [jumpBlock("j", "scene-2", true)]));
        const branches = bodyOf(group);

        expect(branches).toHaveLength(1);
        expect(branches[0].type).toBe("control:do");
        expect(runFrom(bodyOf(branches[0])[0])).toEqual(CALL_CHAIN);
        // The engine refuses a branch that carries a link of its own (`checkActionChain`), so the
        // wrapper has to be the only thing the group sees.
        expect(branches[0].contentNode.getChild()).toBeFalsy();
    });

    it("leaves every other row in the group a branch of its own", async () => {
        const doc = groupDocument({ control: "parallel", mode: "all" } as StoryBlock["payload"], [
            narrationBlock("n1", "Before."),
            jumpBlock("j", "scene-2", true),
            narrationBlock("n2", "After."),
        ]);
        const branches = bodyOf(await groupActionOf(doc));

        expect(branches.map(branch => branch.type)).toEqual(["character:say", "control:do", "character:say"]);
        expect(runFrom(bodyOf(branches[1])[0])).toEqual(CALL_CHAIN);
        // Each narration is still its own single-action branch, linked to nothing.
        expect(branches.every(branch => !branch.contentNode.getChild())).toBe(true);
        expect(await actionsOfRow(doc, "n1")).toHaveLength(1);
        expect(await actionsOfRow(doc, "n2")).toHaveLength(1);
    });
});

describe("what a group does to every other row is unchanged", () => {
    it("leaves a plain jump inside a parallel group as the branches it always was", async () => {
        const doc = groupDocument({ control: "parallel", mode: "all" } as StoryBlock["payload"], [jumpBlock("j", "scene-2")]);
        const branches = bodyOf(await groupActionOf(doc));

        expect(branches.map(branch => branch.type)).toEqual(["control:do", "scene:jumpTo"]);
        expect((await actionsOfRow(doc, "j")).map(action => action.type)).toEqual(["control:do", "scene:jumpTo"]);
    });

    it("leaves a returnable jump inside a sequence group alone, because `Control.do` already links it", async () => {
        const doc = groupDocument({ control: "sequence", mode: "do" } as StoryBlock["payload"], [jumpBlock("j", "scene-2", true)]);
        const body = bodyOf(await groupActionOf(doc));

        expect(body.map(action => action.type)).toEqual(CALL_CHAIN);
        expect(runFrom(body[0])).toEqual(CALL_CHAIN);
        expect((await actionsOfRow(doc, "j")).map(action => action.type)).toEqual(CALL_CHAIN);
    });

    it("leaves a returnable jump at the top level of a scene alone", async () => {
        const doc = document(jumpBlock("j", "scene-2", true));

        expect((await actionsOfRow(doc, "j")).map(action => action.type)).toEqual(CALL_CHAIN);
    });
});
