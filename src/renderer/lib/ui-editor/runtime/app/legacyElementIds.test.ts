import { describe, expect, it } from "vitest";
import { DevTools, Scene, Sound, type SavedGame } from "narraleaf-react";
import type { StoryDocument } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { buildLegacyElementIdTable, translateLegacyElementIds } from "./legacyElementIds";

/**
 * A save written by a build that numbered the camera and the sounds by position, read by one that
 * names them.
 *
 * The old names are not typed in here: they are what the engine's own numbering gives the story once
 * the names the compiler now stamps are taken off again - the very pass the old build ran. So these
 * cases hold for whatever that numbering turns out to be, and fail the way a real save would if the
 * table and the engine ever disagree.
 */

type Element = { getId(): string; setId(id: string): void; toData(): unknown; fromData(data: unknown, map?: Map<string, unknown>): unknown };
type ConstructedStory = {
    constructStory(): unknown;
    camera: Element;
    entryScene: (Element & { getSceneRoot(): unknown; assignElementId(story: unknown): void; getAllChildrenElements(story: unknown, action: unknown): Element[]; getAllChildren(story: unknown, action: unknown): unknown[] }) | null;
};

const ownedSounds = (action: unknown): Element[] =>
    (Scene as unknown as { getOwnedSounds(action: unknown): Element[] }).getOwnedSounds(action);

function row(id: string, payload: Record<string, unknown>, kind = "action") {
    return { kind, id, parentId: null, childrenIds: [], payload };
}

function narration(id: string) {
    return row(id, { action: "narration", text: { textId: `${id}-text`, role: "narration", value: id } }, "nodeAction");
}

/** Scene one has its own music and a `/bgm` row; scene two only its own music. */
function document(options?: { withSceneMusic?: boolean; lineAhead?: boolean }): StoryDocument {
    const first: Record<string, unknown> = {
        ...(options?.lineAhead ? { bell: row("bell", { action: "audio", operation: "playSound", objectName: "bell", assetId: "bell" }) } : {}),
        intro: narration("intro"),
        zoom: row("zoom", { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 1.5 } } }),
        rain: row("rain", { action: "audio", operation: "playSound", objectName: "rain", assetId: "rain-loop", loop: true }),
        theme: row("theme", { action: "audio", operation: "setBgm", assetId: "theme" }),
        onward: row("onward", { targetSceneId: "scene-b" }, "jump"),
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
                ...(options?.withSceneMusic === false ? {} : { bgm: { assetId: "scene-a-music", loop: true } }),
                rootBlockIds: Object.keys(first),
                blocks: first,
            },
            "scene-b": {
                id: "scene-b",
                name: "Two",
                runtimeName: "two",
                bgm: { assetId: "scene-b-music", loop: true },
                rootBlockIds: ["b1"],
                blocks: { b1: narration("b1") },
            },
        },
    } as unknown as StoryDocument;
}

async function constructed(doc: StoryDocument): Promise<ConstructedStory> {
    const compiled = await compileStudioStoryToNlr({
        document: doc,
        sceneId: "scene-a",
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
    const story = compiled.story as unknown as ConstructedStory;
    story.constructStory();
    return story;
}

/** The camera and every sound the story reaches, with each sound keyed by the clip it plays. */
function cast(story: ConstructedStory): { camera: Element; sounds: Map<string, Element>; scenes: Map<string, Element> } {
    const scene = story.entryScene!;
    const root = scene.getSceneRoot();
    const sounds = new Map<string, Element>();
    const scenes = new Map<string, Element>();
    const take = (element: unknown) => {
        if (element instanceof Sound) {
            sounds.set((element as unknown as { config: { src: string } }).config.src, element as unknown as Element);
        }
        if (element instanceof Scene) {
            scenes.set((element as unknown as Element).getId(), element as unknown as Element);
        }
    };
    scene.getAllChildrenElements(story, root).forEach(take);
    scene.getAllChildren(story, root).forEach(action => ownedSounds(action).forEach(take));
    return { camera: story.camera, sounds, scenes };
}

/**
 * The story as the build before this change named it: the stamped names taken off the camera and the
 * sounds, and the engine's own numbering pass run again over the entry scene.
 */
async function writtenByOldBuild(doc: StoryDocument) {
    const story = await constructed(doc);
    const { camera, sounds, scenes } = cast(story);
    for (const element of [camera, ...sounds.values()]) {
        DevTools.setElementStaticId(element as never, null);
        element.setId("");
    }
    story.entryScene!.assignElementId(story);
    return { story, camera, sounds, scenes };
}

/**
 * A save in the shape the engine writes it: the camera zoomed in, the club theme playing twelve
 * seconds in with the scene pointing at it, and the rain loop turned down.
 */
function oldSave(old: Awaited<ReturnType<typeof writtenByOldBuild>>): SavedGame {
    const theme = old.sounds.get("test://theme")!;
    const rain = old.sounds.get("test://rain-loop")!;
    const camera = old.camera.toData() as { transformState: Record<string, unknown> };
    const sceneA = old.scenes.get("nl:scene:scene-a")!;
    const sceneData = sceneA.toData() as { state: Record<string, unknown> };
    return {
        name: "slot",
        meta: { created: 1, updated: 2, id: "m", lastSentence: null, lastSpeaker: null, storyHash: "h", version: 3 },
        game: {
            store: {},
            services: {},
            elementStates: [
                { id: old.camera.getId(), data: { ...camera, transformState: { ...camera.transformState, zoom: 1.5 } } },
                { id: "nl:scene:scene-a", data: { ...sceneData, state: { ...sceneData.state, backgroundMusic: { ...(theme.toData() as object), id: theme.getId() } } } },
                { id: rain.getId(), data: { state: { volume: 0.4, rate: 1, paused: false, muted: false } } },
            ],
            stage: {
                scenes: [{ sceneId: "nl:scene:scene-a", elements: { layers: {} } }],
                audio: { sounds: [[theme.getId(), { isPlaying: true, position: 12.5 }], [rain.getId(), { isPlaying: true, position: 3 }]], groups: [] },
                videos: [],
                vfx: [],
            },
            stackModel: { items: [] },
            asyncStackModels: [],
            history: [],
        },
    } as unknown as SavedGame;
}

describe("a save written while the camera and the sounds were numbered by position", () => {
    it("is not written with today's names - the case is real", async () => {
        const old = await writtenByOldBuild(document());
        expect(old.camera.getId()).toMatch(/^e-\d+$/);
        expect(old.sounds.get("test://theme")!.getId()).toMatch(/^[es]-\d+$/);
        expect(old.sounds.get("test://rain-loop")!.getId()).toMatch(/^e-\d+$/);
    });

    it("loads onto the right camera and the right sounds when the story is the one it was written against", async () => {
        const old = await writtenByOldBuild(document());
        const save = oldSave(old);
        const story = await constructed(document());
        const table = buildLegacyElementIdTable(story as never, ownedSounds);

        const { savedGame, unmappable } = translateLegacyElementIds(save, table, true);
        expect(unmappable).toEqual([]);

        // Applied the way `deserialize` does it, against today's story.
        const now = cast(story);
        const byId = new Map<string, Element>([
            [now.camera.getId(), now.camera],
            ...[...now.sounds.values()].map(sound => [sound.getId(), sound] as const),
            ...[...now.scenes.entries()],
        ]);
        const game = savedGame.game as unknown as {
            elementStates: { id: string; data: unknown }[];
            stage: { audio: { sounds: [string, unknown][] } };
        };
        for (const entry of game.elementStates) {
            const element = byId.get(entry.id);
            expect(element, entry.id).toBeDefined();
            element!.fromData(entry.data, byId as Map<string, unknown>);
        }

        expect((now.camera.toData() as { transformState: { zoom: number } }).transformState.zoom).toBe(1.5);
        const sceneA = now.scenes.get("nl:scene:scene-a") as unknown as { state: { backgroundMusic: unknown } };
        expect(sceneA.state.backgroundMusic).toBe(now.sounds.get("test://theme"));
        expect((now.sounds.get("test://rain-loop")!.toData() as { state: { volume: number } }).state.volume).toBe(0.4);
        expect(game.stage.audio.sounds.map(([id]) => byId.get(id))).toEqual([
            now.sounds.get("test://theme"),
            now.sounds.get("test://rain-loop"),
        ]);
    });

    it("still finds the camera, and a scene's only track, after the story has changed", async () => {
        // A patch wrote a line ahead of everything: every number after it moved, so the walk is no
        // longer the one the save was written under and is not used.
        const old = await writtenByOldBuild(document({ withSceneMusic: false }));
        const save = oldSave(old);
        const story = await constructed(document({ withSceneMusic: false, lineAhead: true }));
        const table = buildLegacyElementIdTable(story as never, ownedSounds);

        const withoutRain = {
            ...save,
            game: {
                ...(save.game as object),
                elementStates: (save.game as unknown as { elementStates: { id: string }[] }).elementStates.slice(0, 2),
            },
        } as unknown as SavedGame;
        const { savedGame, unmappable } = translateLegacyElementIds(withoutRain, table, false);
        expect(unmappable).toEqual([]);
        const game = savedGame.game as unknown as {
            elementStates: { id: string; data: { state?: { backgroundMusic?: { id: string } } } }[];
            stage: { audio: { sounds: [string, unknown][] } };
        };
        expect(game.elementStates.map(entry => entry.id)).toEqual(["nl:camera", "nl:scene:scene-a"]);
        expect(game.elementStates[1].data.state?.backgroundMusic?.id).toBe("nl:bgm:scene-a:theme");
        // The theme comes back at its place; the rain loop, which nothing can name now, is left out
        // as the engine leaves out a clip the story does not have.
        expect(game.stage.audio.sounds.map(([id]) => id)).toEqual(["nl:bgm:scene-a:theme"]);
    });

    it("is refused, not guessed, where a changed story leaves a sound it holds state for unnamed", async () => {
        const old = await writtenByOldBuild(document());
        const save = oldSave(old);
        const story = await constructed(document({ lineAhead: true }));
        const table = buildLegacyElementIdTable(story as never, ownedSounds);

        const { unmappable } = translateLegacyElementIds(save, table, false);
        // The scene's pointer could be to its own music or to the `/bgm` row's track, and the rain
        // loop's number now belongs to something else.
        expect(unmappable).toEqual([old.sounds.get("test://rain-loop")!.getId(), old.sounds.get("test://theme")!.getId()].sort());
    });

    it("leaves a save written with today's names exactly as it is", async () => {
        const story = await constructed(document());
        const table = buildLegacyElementIdTable(story as never, ownedSounds);
        const save = {
            name: "slot",
            meta: {},
            game: {
                elementStates: [{ id: "nl:camera", data: { transformState: { zoom: 2 } } }],
                stage: { scenes: [], audio: { sounds: [["nl:scene:scene-a:music", { isPlaying: true }]] }, videos: [], vfx: [] },
                history: [],
            },
        } as unknown as SavedGame;
        expect(translateLegacyElementIds(save, table, true)).toEqual({ savedGame: save, unmappable: [] });
    });
});
