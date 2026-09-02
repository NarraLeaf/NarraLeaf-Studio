import { describe, expect, it } from "vitest";
import { DevTools, Story } from "narraleaf-react";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { createPlayHead, PLAY_HEAD_TRAIL_LIMIT, type PlayHeadActionBinding } from "./playHead";

function narrationBlock(id: string, value: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `${id}-t`, value, role: "narration" } },
    } as StoryBlock;
}

function returnableJump(id: string, targetSceneId: string): StoryBlock {
    return { id, kind: "jump", parentId: null, childrenIds: [], payload: { targetSceneId, returnable: true } };
}

/** A story whose second row is a returnable jump. */
function callingDocument(): StoryDocument {
    const rows = [narrationBlock("a1", "Before."), returnableJump("j", "scene-2"), narrationBlock("a2", "After.")];
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [],
        entrySceneId: "scene-1",
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Corridor",
                runtimeName: "scene-1",
                rootBlockIds: rows.map(row => row.id),
                blocks: Object.fromEntries(rows.map(row => [row.id, row])),
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

/**
 * The compiled story's actions in the order the engine walks them, each carrying the id the engine
 * will report for it once its own id pass has run.
 *
 * Both the walk and the id pass are `@internal`, so `stripInternal` takes them out of the shipped
 * declarations - the structural cast is how a test reaches the same two passes the engine performs
 * on every story it loads. Going through them is the entire point: the ids this yields are the ids
 * the play head will actually be handed, rather than ids a fixture made up.
 */
async function compiledRun(): Promise<{
    bindings: PlayHeadActionBinding[];
    actions: { type: string; id: string; named: boolean }[];
}> {
    const compiled = await compileStudioStoryToNlr({
        document: callingDocument(),
        sceneId: "scene-1",
        characters: [],
        resolveAssetUrl: async assetId => `nlr://${assetId}`,
    });
    expect(compiled.diagnostics).toEqual([]);

    const story = new Story("t").entry(compiled.scene) as unknown as { constructStory: () => void };
    story.constructStory();
    const scene = compiled.scene as unknown as {
        getAllChildren: (
            story: unknown,
            root: unknown,
            options: { allowFutureScene: boolean },
        ) => { type: string; getId: () => string }[];
        getSceneRoot: () => unknown;
        assignActionId: (story: unknown) => void;
    };
    scene.assignActionId(story);

    const bindings = compiled.actionIdBindings.map(binding => ({
        staticId: binding.staticId,
        blockId: binding.blockId,
    }));
    const named = new Set(bindings.map(binding => binding.staticId));
    const actions = scene
        .getAllChildren(story, scene.getSceneRoot(), { allowFutureScene: true })
        .map(action => ({ type: action.type, id: action.getId(), named: named.has(action.getId()) }));
    return { bindings, actions };
}

describe("what a returnable jump actually compiles to", () => {
    it("leaves the action that throws unnamed, and names the one that runs before it", async () => {
        // The premise the whole resolution rests on, checked against a real compile rather than
        // assumed. `scene:preSuspend` - the action that refuses a call to a scene already on the
        // stage - is the engine's own machinery, so it carries a positional id and is in no binding
        // table. That is why resolving the CURRENT action alone reported this failure as having no
        // place in the author's story at all.
        const { actions, bindings } = await compiledRun();

        const preSuspend = actions.find(action => action.type === "scene:preSuspend");
        expect(preSuspend).toBeDefined();
        expect(preSuspend?.named).toBe(false);
        expect(preSuspend?.id).toMatch(/^a-\d+$/);
        expect(bindings.some(binding => binding.staticId === preSuspend?.id)).toBe(false);

        // And the action immediately before it is the jump row's own.
        const index = actions.findIndex(action => action.type === "scene:preSuspend");
        const before = actions[index - 1];
        expect(before?.type).toBe("control:do");
        expect(bindings.find(binding => binding.staticId === before?.id)?.blockId).toBe("j");
    });
});

describe("the play head over a real run", () => {
    it("names the jump row for a failure raised by the machinery that row expanded into", async () => {
        const { actions, bindings } = await compiledRun();
        const playHead = createPlayHead(() => bindings);

        // Walk the actions the way the engine does, stopping on the one that throws: the engine
        // publishes the play head BEFORE running each action, so by the time `scene:preSuspend`
        // fails the head is standing on it.
        for (const action of actions) {
            playHead.observe(action.id);
            if (action.type === "scene:preSuspend") {
                break;
            }
        }

        expect(playHead.actionId()).toMatch(/^a-\d+$/);
        expect(playHead.blockId()).toBe("j");
    });

    it("names the row itself while an ordinary row is playing", async () => {
        const { actions, bindings } = await compiledRun();
        const playHead = createPlayHead(() => bindings);
        const say = actions.find(action => action.named && action.type === "character:say");

        playHead.observe(say?.id ?? null);

        expect(playHead.blockId()).toBe("a1");
    });

    it("has no row to offer before the run reaches one", async () => {
        const { actions, bindings } = await compiledRun();
        const playHead = createPlayHead(() => bindings);

        // Everything the engine runs to raise a scene comes before the first authored row, and a
        // failure in there really does belong to no row - which is what makes such a report
        // `session` rather than a guess.
        for (const action of actions) {
            if (action.named) {
                break;
            }
            playHead.observe(action.id);
        }

        expect(playHead.blockId()).toBeUndefined();
    });

    it("forgets the run when the session goes", async () => {
        const { actions, bindings } = await compiledRun();
        const playHead = createPlayHead(() => bindings);
        playHead.observe(actions.find(action => action.named)?.id ?? null);
        expect(playHead.blockId()).toBe("a1");

        playHead.reset();

        expect(playHead.actionId()).toBeNull();
        expect(playHead.blockId()).toBeUndefined();
    });
});

describe("the play head against a table that moves", () => {
    it("resolves against the current compile, not the one it was created with", () => {
        // A hot reload recompiles the story and mints a new table. The play head reads it at call
        // time precisely so a stale table cannot answer for rows that no longer exist.
        let bindings: PlayHeadActionBinding[] = [{ staticId: "s-1", blockId: "old-row" }];
        const playHead = createPlayHead(() => bindings);
        playHead.observe("s-1");
        expect(playHead.blockId()).toBe("old-row");

        bindings = [{ staticId: "s-1", blockId: "new-row" }];

        expect(playHead.blockId()).toBe("new-row");
    });

    it("keeps the engine's view of a bound action agreeing with the table", async () => {
        // The table is only worth reading because the compiler stamps the very same id onto the
        // action object the engine will run. This is that join, checked rather than trusted.
        const compiled = await compileStudioStoryToNlr({
            document: callingDocument(),
            sceneId: "scene-1",
            characters: [],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });
        expect(compiled.actionIdBindings.length).toBeGreaterThan(0);
        expect(
            compiled.actionIdBindings.every(binding => DevTools.getStaticId(binding.action) === binding.staticId),
        ).toBe(true);
    });
});

describe("the trail of rows a run has played", () => {
    it("keeps them in the order they were played", () => {
        const playHead = createPlayHead(() => [
            { staticId: "s-1", blockId: "r1" },
            { staticId: "s-2", blockId: "r2" },
            { staticId: "s-3", blockId: "r3" },
        ]);

        // Interleaved with the engine's own machinery, which names no row: only the rows land.
        playHead.observe("s-1");
        playHead.observe("a-0");
        playHead.observe("s-2");
        playHead.observe("a-1");
        playHead.observe("s-3");

        expect([...playHead.trail()]).toEqual(["r1", "r2", "r3"]);
    });

    it("collapses a row that keeps reporting itself, so the window holds real span", () => {
        // A row expands into a chain and a loop re-enters it; without this the bound would be spent
        // on one id repeated, and the reload would have nothing earlier to fall back to.
        const playHead = createPlayHead(() => [
            { staticId: "s-1", blockId: "r1" },
            { staticId: "s-1b", blockId: "r1" },
            { staticId: "s-2", blockId: "r2" },
        ]);

        playHead.observe("s-1");
        playHead.observe("s-1b");
        playHead.observe("s-2");
        playHead.observe("s-1");

        expect([...playHead.trail()]).toEqual(["r1", "r2", "r1"]);
    });

    it("holds at most the bound, keeping the most recent rows", () => {
        const bindings = Array.from({ length: PLAY_HEAD_TRAIL_LIMIT + 10 }, (_, index) => ({
            staticId: `s-${index}`,
            blockId: `r-${index}`,
        }));
        const playHead = createPlayHead(() => bindings);
        for (const binding of bindings) {
            playHead.observe(binding.staticId);
        }

        const trail = playHead.trail();
        expect(trail).toHaveLength(PLAY_HEAD_TRAIL_LIMIT);
        expect(trail[trail.length - 1]).toBe(`r-${bindings.length - 1}`);
        expect(trail[0]).toBe("r-10");
    });

    it("forgets it with the run", () => {
        const playHead = createPlayHead(() => [{ staticId: "s-1", blockId: "r1" }]);
        playHead.observe("s-1");
        expect([...playHead.trail()]).toEqual(["r1"]);

        playHead.reset();

        expect([...playHead.trail()]).toEqual([]);
    });
});
