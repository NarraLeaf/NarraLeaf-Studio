/**
 * The visited record, end to end through the compiler.
 *
 * These cases care about TIMING above all else, because timing is the whole reason the record
 * exists: an option must be recorded when it is picked, not when its menu appears. That is exactly
 * what `game.isTextRead` gets wrong for this purpose, so "a menu was shown and nothing was written"
 * is the load-bearing assertion here, not a nicety.
 *
 * The compiled statements are driven directly rather than through a running game: a `Script` action
 * carries its handler, so invoking it against a fake `Storable` reproduces exactly what the engine
 * would do at that point in the action list, without a DOM or a game loop.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStudioStoryToNlr } from "./storyCompiler";
import { STORY_VISITED_OPTIONS_KEY, STORY_VISITED_SCENES_KEY } from "./storyVisited";

/** A `Storable` stand-in with just the two calls the record's script touches. */
function createFakeStorable() {
    const namespaces = new Map<string, Map<string, unknown>>();
    const namespaceFor = (name: string) => {
        const existing = namespaces.get(name);
        if (existing) {
            return existing;
        }
        const created = new Map<string, unknown>();
        namespaces.set(name, created);
        return created;
    };
    return {
        storable: {
            hasNamespace: (name: string) => namespaces.has(name),
            getNamespace: (name: string) => {
                const content = namespaceFor(name);
                return {
                    get: (key: string) => content.get(key),
                    set: (key: string, value: unknown) => content.set(key, value),
                };
            },
        },
        read: (namespace: string, key: string): string[] => {
            const value = namespaces.get(namespace)?.get(key);
            return Array.isArray(value) ? (value as string[]) : [];
        },
    };
}

type AnyAction = {
    type?: string;
    contentNode?: { getContent: () => any };
    getFutureActions?: (story: unknown, options: { allowFutureScene: boolean }) => AnyAction[];
};

/** Every action reachable from `root`, in walk order. */
function walkActions(root: AnyAction, story: unknown, seen = new Set<AnyAction>()): AnyAction[] {
    if (!root || seen.has(root)) {
        return [];
    }
    seen.add(root);
    const children = typeof root.getFutureActions === "function"
        ? root.getFutureActions(story, { allowFutureScene: true })
        : [];
    return [root, ...children.flatMap(child => walkActions(child, story, seen))];
}

/** Run a `Script` action's handler against a fake store, the way the engine would. */
function runScript(action: AnyAction, storable: unknown): void {
    const script = action.contentNode?.getContent();
    script.handler({ storable });
}

function choiceDocument(options: { sceneName?: string; optionAText?: string } = {}): StoryDocument {
    const blocks: Record<string, StoryBlock> = {
        choice: {
            id: "choice",
            kind: "nodeAction",
            parentId: null,
            childrenIds: ["opt-a", "opt-b"],
            payload: { action: "choice", prompt: { textId: "t-prompt", value: "Which?", role: "choicePrompt" } },
        },
        "opt-a": {
            id: "opt-a",
            kind: "nodeAction",
            parentId: "choice",
            childrenIds: [],
            payload: {
                action: "choiceOption",
                text: { textId: "t-a", value: options.optionAText ?? "Stay", role: "choiceText" },
            },
        },
        "opt-b": {
            id: "opt-b",
            kind: "nodeAction",
            parentId: "choice",
            childrenIds: ["leave"],
            payload: { action: "choiceOption", text: { textId: "t-b", value: "Leave", role: "choiceText" } },
        },
        leave: {
            id: "leave",
            kind: "jump",
            parentId: "opt-b",
            childrenIds: [],
            payload: { targetSceneId: "scene-2" },
        },
    };
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1", "scene-2"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: options.sceneName ?? "Scene 1",
                runtimeName: options.sceneName ?? "Scene 1",
                rootBlockIds: ["choice"],
                blocks,
            },
            "scene-2": {
                id: "scene-2",
                name: "Scene 2",
                runtimeName: "Scene 2",
                rootBlockIds: [],
                blocks: {},
            },
        },
    };
}

/**
 * Compile, then hand back the pieces the timing cases need: the statement at the head of each
 * scene, and the statement at the head of each choice option's own branch.
 */
async function compileAndDissect(document: StoryDocument) {
    const compiled = await compileStudioStoryToNlr({
        document,
        sceneId: "scene-1",
        characters: [],
        resolveAssetUrl: async (assetId: string) => `nlr://${assetId}`,
    });
    // Scene roots only exist once the story is constructed; that is what `LiveGame.loadStory` does.
    const built = (compiled.story as any).constructStory();
    const sceneHeadScript = (sceneId: string): AnyAction => {
        const root = (compiled.scenes[sceneId] as any).getSceneRoot();
        const script = walkActions(root, built).find(action => action.type === "script:action");
        expect(script, `no script action at the head of ${sceneId}`).toBeDefined();
        return script!;
    };
    const root = (compiled.scenes["scene-1"] as any).getSceneRoot();
    const menu = walkActions(root, built).find(action => action.type === "menu:action");
    expect(menu).toBeDefined();
    const choices = menu!.contentNode!.getContent().choices as Array<{ action: AnyAction[] }>;

    return {
        compiled,
        sceneHeadScript,
        /** The first statement of one option's branch - the one that runs only if it is picked. */
        optionHead: (index: number) => choices[index].action[0],
        optionCount: choices.length,
    };
}

describe("visited record - compiler", () => {
    it("gives the record its own namespace, distinct from the saved-variable one", async () => {
        const { compiled } = await compileAndDissect(choiceDocument());

        expect(compiled.visitedNamespaceName).toBeTruthy();
        expect(compiled.visitedNamespaceName).not.toBe(compiled.savedNamespaceName);
        expect(compiled.diagnostics).toEqual([]);
    });

    it("records the scene id when the scene starts", async () => {
        const { compiled, sceneHeadScript } = await compileAndDissect(choiceDocument());
        const fake = createFakeStorable();

        runScript(sceneHeadScript("scene-1"), fake.storable);

        expect(fake.read(compiled.visitedNamespaceName, STORY_VISITED_SCENES_KEY)).toEqual(["scene-1"]);
        // Every scene records itself, not just the entry one.
        runScript(sceneHeadScript("scene-2"), fake.storable);
        expect(fake.read(compiled.visitedNamespaceName, STORY_VISITED_SCENES_KEY)).toEqual(["scene-1", "scene-2"]);
    });

    it("re-entering a recorded scene writes nothing twice", async () => {
        const { compiled, sceneHeadScript } = await compileAndDissect(choiceDocument());
        const fake = createFakeStorable();
        const head = sceneHeadScript("scene-1");

        runScript(head, fake.storable);
        runScript(head, fake.storable);

        expect(fake.read(compiled.visitedNamespaceName, STORY_VISITED_SCENES_KEY)).toEqual(["scene-1"]);
    });

    it("records an option only when it is PICKED, not when the menu shows it", async () => {
        const { compiled, sceneHeadScript, optionHead, optionCount } = await compileAndDissect(choiceDocument());
        const fake = createFakeStorable();

        expect(optionCount).toBe(2);
        // Reaching the menu means running everything up to it: the scene head and (conceptually) the
        // menu action itself. Neither may touch the options collection.
        runScript(sceneHeadScript("scene-1"), fake.storable);
        expect(fake.read(compiled.visitedNamespaceName, STORY_VISITED_OPTIONS_KEY)).toEqual([]);

        // The player picks the first option. Only that branch runs.
        runScript(optionHead(0), fake.storable);

        expect(fake.read(compiled.visitedNamespaceName, STORY_VISITED_OPTIONS_KEY)).toEqual(["opt-a"]);
        // The option that was merely on screen is still unrecorded - the exact thing the engine's
        // text-read record cannot express.
        expect(fake.read(compiled.visitedNamespaceName, STORY_VISITED_OPTIONS_KEY)).not.toContain("opt-b");
    });

    it("records the other option's id when that one is picked instead", async () => {
        const { compiled, optionHead } = await compileAndDissect(choiceDocument());
        const fake = createFakeStorable();

        runScript(optionHead(1), fake.storable);

        expect(fake.read(compiled.visitedNamespaceName, STORY_VISITED_OPTIONS_KEY)).toEqual(["opt-b"]);
    });

    it("keys on ids, so renaming the scene and rewriting the option text hits the same record", async () => {
        const before = await compileAndDissect(choiceDocument());
        const beforeStore = createFakeStorable();
        runScript(before.sceneHeadScript("scene-1"), beforeStore.storable);
        runScript(before.optionHead(0), beforeStore.storable);

        const after = await compileAndDissect(choiceDocument({
            sceneName: "A Completely Different Name",
            optionAText: "...actually, let me reconsider that",
        }));
        const afterStore = createFakeStorable();
        runScript(after.sceneHeadScript("scene-1"), afterStore.storable);
        runScript(after.optionHead(0), afterStore.storable);

        const namespace = before.compiled.visitedNamespaceName;
        expect(after.compiled.visitedNamespaceName).toBe(namespace);
        expect(afterStore.read(namespace, STORY_VISITED_SCENES_KEY))
            .toEqual(beforeStore.read(namespace, STORY_VISITED_SCENES_KEY));
        expect(afterStore.read(namespace, STORY_VISITED_OPTIONS_KEY))
            .toEqual(beforeStore.read(namespace, STORY_VISITED_OPTIONS_KEY));
        expect(afterStore.read(namespace, STORY_VISITED_SCENES_KEY)).toEqual(["scene-1"]);
        expect(afterStore.read(namespace, STORY_VISITED_OPTIONS_KEY)).toEqual(["opt-a"]);
    });
});
