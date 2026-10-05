import { describe, expect, it } from "vitest";
import { Scene, Sound } from "narraleaf-react";
import { compileStudioStoryToNlr } from "./storyCompiler";
import type { StoryDocument } from "@shared/types/story";

/**
 * A save restores element state by element id. The engine names elements by their position in a
 * walk of the action tree unless the host names them, and a position moves the moment a line is
 * written ahead of it - so the id in an old save would still exist and would mean a different
 * element. That failure is silent, which is why it is worth a test of its own.
 */

const BACKGROUND = "11111111-1111-4111-8111-111111111111";

function narration(id: string, text: string) {
    return {
        kind: "nodeAction",
        id,
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `${id}-text`, role: "narration", value: text } },
    };
}

function background(id: string) {
    return {
        kind: "action",
        id,
        parentId: null,
        childrenIds: [],
        payload: { action: "setBackground", assetId: BACKGROUND },
    };
}

function document(): StoryDocument {
    return {
        schemaVersion: 16,
        id: "story-1",
        name: "Story",
        scenes: {
            "scene-a": {
                id: "scene-a",
                name: "One",
                runtimeName: "one",
                rootBlockIds: ["a1"],
                blocks: { a1: narration("a1", "first") },
            },
            "scene-b": {
                id: "scene-b",
                name: "Two",
                runtimeName: "two",
                rootBlockIds: ["b1"],
                blocks: { b1: narration("b1", "second") },
            },
        },
    } as unknown as StoryDocument;
}

/**
 * `elementId -> the state that element holds`, over the same walk of the action tree that names
 * the cast and that a save is written from.
 *
 * This reads the walk rather than `getAllElementStates()`. From engine 0.26.0 a save lists only the
 * elements whose state differs from what the script wrote, so a freshly constructed story serializes
 * to nothing at all - which says everything about the save and nothing about the naming this file is
 * here to pin down. Reading the save back would make every assertion below pass vacuously.
 *
 * Elements whose `toData()` is `null` are left out: a `Sentence` is an element the walk reaches and
 * names, but it serializes to nothing by construction, so no name it is given can ever put one
 * element's state on another. The name only has to be stable for what a save carries.
 */
async function elementStates(doc: StoryDocument): Promise<Map<string, string>> {
    const compiled = await compileStudioStoryToNlr({
        document: doc,
        sceneId: "scene-a",
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
    const story = compiled.story as unknown as {
        constructStory(): unknown;
        entryScene: { getSceneRoot(): unknown } | null;
        getAllChildrenElements(story: unknown, action: unknown): { getId(): string; toData(): unknown }[];
    };
    story.constructStory();
    const elements = story.getAllChildrenElements(story, story.entryScene?.getSceneRoot() ?? []);
    return new Map(
        elements
            .map(element => [element.getId(), element.toData()] as const)
            .filter((entry): entry is readonly [string, object] => entry[1] != null)
            .map(([id, data]) => [id, JSON.stringify(data)]),
    );
}

describe("element ids", () => {
    it("names every element from the document rather than by position", async () => {
        const states = await elementStates(document());
        expect(states.size).toBeGreaterThan(0);
        expect([...states.keys()].filter(id => /^e-\d+$/.test(id))).toEqual([]);
    });

    it("keeps each id pointing at the same element when a line is inserted ahead of it", async () => {
        const before = await elementStates(document());

        const edited = document();
        edited.scenes["scene-a"].blocks.a0 = background("a0") as never;
        edited.scenes["scene-a"].rootBlockIds.unshift("a0");
        const after = await elementStates(edited);

        // Every id the old save carries must still describe what it described. An id that survives
        // while its state changes shape is the corruption case, not a pass.
        const moved = [...before.keys()].filter(id => after.has(id) && after.get(id) !== before.get(id));
        expect(moved).toEqual([]);
        expect([...before.keys()].filter(id => !after.has(id))).toEqual([]);
    });

    it("names a scene's own background and layers after the scene", async () => {
        // Only the entry scene's elements appear: the walk follows the action tree, and nothing in
        // this document jumps to the second scene. That is the engine's reach, not a naming gap.
        const states = await elementStates(document());
        expect(states.has("nl:scene:scene-a:background")).toBe(true);
        expect(states.has("nl:scene:scene-a:layer:background")).toBe(true);
        expect(states.has("nl:scene:scene-a:layer:displayable")).toBe(true);
    });
});

/**
 * The camera and the sounds, which the engine numbered by where its walk of the action tree first met
 * them until the compiler named them: `e-<n>` for the camera and for a sound a row acts on, `s-<n>` for
 * a scene's music. Both numbers moved with the scene the story was entered at and with every line
 * written ahead of them, so a save's camera and music state went onto whatever had taken the number.
 */
function rowBlock(id: string, payload: Record<string, unknown>, kind = "action") {
    return { kind, id, parentId: null, childrenIds: [], payload };
}

function stagedDocument(): StoryDocument {
    const first = {
        intro: narration("intro", "first"),
        zoom: rowBlock("zoom", { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 1.5 } } }),
        rain: rowBlock("rain", { action: "audio", operation: "playSound", objectName: "rain", assetId: "rain-loop", loop: true }),
        theme: rowBlock("theme", { action: "audio", operation: "setBgm", assetId: "theme" }),
        onward: rowBlock("onward", { targetSceneId: "scene-b" }, "jump"),
    };
    return {
        schemaVersion: 16,
        id: "story-1",
        name: "Story",
        scenes: {
            "scene-a": {
                id: "scene-a",
                name: "One",
                runtimeName: "one",
                bgm: { assetId: "scene-a-music", loop: true },
                rootBlockIds: Object.keys(first),
                blocks: first,
            },
            "scene-b": {
                id: "scene-b",
                name: "Two",
                runtimeName: "two",
                bgm: { assetId: "scene-b-music", loop: true },
                rootBlockIds: ["b1", "pan"],
                blocks: {
                    b1: narration("b1", "second"),
                    pan: rowBlock("pan", { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 2 } } }),
                },
            },
        },
    } as unknown as StoryDocument;
}

/** Element id -> kind, for the camera and every sound the constructed story can reach. */
async function cameraAndSounds(doc: StoryDocument, entry: string): Promise<Map<string, string>> {
    const compiled = await compileStudioStoryToNlr({
        document: doc,
        sceneId: entry,
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
    const story = compiled.story as unknown as {
        constructStory(): unknown;
        camera: { getId(): string };
        entryScene: { getSceneRoot(): unknown } | null;
        getAllChildren(story: unknown, action: unknown): unknown[];
        getAllChildrenElements(story: unknown, action: unknown): { getId(): string; constructor: { name: string } }[];
    };
    story.constructStory();
    const ids = new Map<string, string>([[story.camera.getId(), "camera"]]);
    const root = story.entryScene?.getSceneRoot() ?? [];
    for (const element of story.getAllChildrenElements(story, root)) {
        if (element instanceof Sound) {
            ids.set(element.getId(), `sound ${(element as unknown as { config: { src: string } }).config.src}`);
        }
    }
    for (const action of story.getAllChildren(story, root)) {
        for (const sound of (Scene as unknown as { getOwnedSounds(action: unknown): Sound[] }).getOwnedSounds(action)) {
            ids.set((sound as unknown as { getId(): string }).getId(), `sound ${(sound as unknown as { config: { src: string } }).config.src}`);
        }
    }
    return ids;
}

describe("the camera and the sounds", () => {
    it("leave nothing a save can hold under a positional name", async () => {
        const doc = stagedDocument();
        const states = await elementStates(doc);
        expect(states.size).toBeGreaterThan(0);
        expect([...states.keys()].filter(id => /^[es]-\d+$/.test(id))).toEqual([]);
    });

    it("are named from what they are", async () => {
        const ids = await cameraAndSounds(stagedDocument(), "scene-a");
        expect(Object.fromEntries(ids)).toEqual({
            "nl:camera": "camera",
            "nl:scene:scene-a:music": "sound test://scene-a-music",
            "nl:scene:scene-b:music": "sound test://scene-b-music",
            "nl:bgm:scene-a:theme": "sound test://theme",
            "nl:sound:scene-a:rain": "sound test://rain-loop",
        });
    });

    it("keep their names when the story is entered at another scene", async () => {
        const fromStart = await cameraAndSounds(stagedDocument(), "scene-a");
        const fromLater = await cameraAndSounds(stagedDocument(), "scene-b");
        for (const [id, what] of fromLater) {
            expect(fromStart.get(id)).toBe(what);
        }
        expect(fromLater.get("nl:camera")).toBe("camera");
    });

    it("keep their names when lines are written ahead of them", async () => {
        const before = await cameraAndSounds(stagedDocument(), "scene-a");
        const edited = stagedDocument();
        const scene = edited.scenes["scene-a"];
        scene.blocks.early = rowBlock("early", { action: "audio", operation: "playSound", objectName: "bell", assetId: "bell" }) as never;
        scene.blocks.tilt = rowBlock("tilt", { action: "camera", operation: "transform", transform: { mode: "props", to: { rotation: 5 } } }) as never;
        scene.rootBlockIds.unshift("early", "tilt");
        const after = await cameraAndSounds(edited, "scene-a");
        for (const [id, what] of before) {
            expect(after.get(id)).toBe(what);
        }
    });
});
