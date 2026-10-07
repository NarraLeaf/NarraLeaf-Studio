import { afterEach, describe, expect, it } from "vitest";
import type { StoryActionPayload, StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { BUILTIN_AUDIO_TRACKS } from "@shared/types/audioTrack";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import { buildStoryCommandContext } from "./storyCommandContext";
import { parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine } from "./storyCommandResolution";

/** One action block per line, in root order - enough to exercise the stage-object collection. */
function documentWith(payloads: Record<string, StoryActionPayload>): StoryDocument {
    const blocks: Record<string, StoryBlock> = {};
    const rootBlockIds: string[] = [];
    for (const [id, payload] of Object.entries(payloads)) {
        blocks[id] = { id, kind: "action", parentId: null, childrenIds: [], payload };
        rootBlockIds.push(id);
    }
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: { "scene-1": { id: "scene-1", name: "Scene", runtimeName: "scene", rootBlockIds, blocks } },
    };
}

describe("buildStoryCommandContext - stage objects", () => {
    it("collects the named objects an author can reference, per kind", () => {
        const document = documentWith({
            b1: { action: "image", operation: "create", objectName: "hero", assetId: "img-1" },
            b2: { action: "text", operation: "create", objectName: "title", text: "Hi" },
            b3: { action: "layer", operation: "create", objectName: "fx" },
            b4: { action: "video", operation: "play", objectName: "clip", assetId: "vid-1" },
            b5: { action: "audio", operation: "playSound", objectName: "music", assetId: "aud-1" },
            b6: { action: "vfx", operation: "create", objectName: "rain", assetId: "vid-2" },
        });

        const context = buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document,
            sceneId: "scene-1",
            scene: document.scenes["scene-1"],
        });

        // This is what makes `/show`, `/swap`, `/stop` a pick rather than a guess - image/text/layer
        // via the shared displayable collector; video, audio and vfx are scanned off the blocks,
        // since none of the three is a Displayable and the shared collector does not know them.
        expect(context.stageObjects.image).toEqual(["hero"]);
        expect(context.stageObjects.text).toEqual(["title"]);
        expect(context.stageObjects.layer).toEqual(["fx"]);
        expect(context.stageObjects.video).toEqual(["clip"]);
        expect(context.stageObjects.audio).toEqual(["music"]);
        expect(context.stageObjects.vfx).toEqual(["rain"]);
    });

    it("does not offer an ambience overlay another scene started", () => {
        // An overlay leaves the stage with the scene that started it, like every other kind here, so
        // the scene the author is standing in has no rain unless it starts its own.
        const document = documentWith({
            b1: { action: "image", operation: "create", objectName: "hero", assetId: "img-1" },
            b2: { action: "vfx", operation: "create", objectName: "petals", assetId: "vid-1" },
        });
        document.scenes["scene-2"] = {
            id: "scene-2",
            name: "Second",
            runtimeName: "second",
            rootBlockIds: ["c1"],
            blocks: {
                c1: {
                    id: "c1", kind: "action", parentId: null, childrenIds: [],
                    payload: { action: "vfx", operation: "create", objectName: "rain", assetId: "vid-9" },
                },
            },
        };

        const context = buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document,
            sceneId: "scene-1",
            scene: document.scenes["scene-1"],
        });

        expect(context.stageObjects.vfx).toEqual(["petals"]);
        expect(context.stageObjects.image).toEqual(["hero"]);
    });

    it("is empty, not undefined, when there is no scene", () => {
        const context = buildStoryCommandContext({ assets: undefined, characters: [], document: null, sceneId: null, scene: null });
        expect(context.stageObjects).toEqual({ image: [], text: [], layer: [], video: [], audio: [], vfx: [] });
    });

    it("names the row that declares each object, and only a row that declares one", () => {
        const document = documentWith({
            b1: { action: "image", operation: "show", objectName: "poster" },
            b2: { action: "image", operation: "create", objectName: "hero", assetId: "img-1" },
            b3: { action: "video", operation: "play", objectName: "Clip", assetId: "vid-1" },
            b4: { action: "audio", operation: "playSound", objectName: "music", assetId: "aud-1" },
            b5: { action: "audio", operation: "setVolume", objectName: "ambience", volume: 0.5 },
        });

        const context = buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document,
            sceneId: "scene-1",
            scene: document.scenes["scene-1"],
        });

        // `poster` and `ambience` are addressable - the engine materialises an object on first
        // mention - but nothing declares them, so there is no row a reference could honestly bind to.
        expect(context.stageObjectSources).toEqual({
            image: { hero: "b2" },
            text: {},
            layer: {},
            video: { clip: "b3" },
            audio: { music: "b4" },
            vfx: {},
        });
        expect(context.stageObjects.image).toEqual(["poster", "hero"]);
    });

    it("indexes characters by id, and carries the stage key their entrance derives", () => {
        const document = documentWith({
            b1: { action: "character", operation: "enter", characterId: "c1", objectName: "Alice" },
            // No stage name: the portrait is registered under the character id, and nothing but this
            // table can say so - the cast name a line is matched on cannot be turned back into it.
            b2: { action: "character", operation: "enter", characterId: "c2" },
            // Not an entrance, so not a declaration: it addresses a portrait it did not create.
            b3: { action: "character", operation: "expression", characterId: "c3", pose: "p1" },
            b4: { action: "character", operation: "enter", characterId: "c1", objectName: "Alice again" },
        });

        const context = buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document,
            sceneId: "scene-1",
            scene: document.scenes["scene-1"],
        });

        // A separate table from `stageObjectSources`, keyed by an id the project owns rather than by
        // a stage name - and first entrance wins, the same rule the stage-object scan follows.
        expect(context.characterSources).toEqual({
            c1: { blockId: "b1", name: "Alice" },
            c2: { blockId: "b2", name: "c2" },
        });
    });
});

describe("buildStoryCommandContext - variables", () => {
    /**
     * Both project scopes are two-surface. The persistent arm has always merged the registry with the
     * story rows; the saved arm read only the document, so a `/set` naming a registry-declared saved
     * variable reported "unknown variable" for a variable the compiler resolves perfectly well - and
     * after the declaration migration that is every saved variable in the project.
     *
     * The two ARE addressed differently on purpose: saved by entry id, persistent by storage key.
     */
    it("offers registry-declared saved variables, addressed by entry id", () => {
        const context = buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document: null,
            sceneId: null,
            scene: null,
            savedVariables: [
                { id: "sv-1", name: "Affection", scope: "saved", valueType: "number", storageKey: "sk-1", defaultValue: 0 },
            ],
            persistentVariables: [
                { id: "pv-1", name: "Playthroughs", scope: "persistent", valueType: "number", storageKey: "pk-1" },
            ],
        });

        expect(context.variables).toEqual([
            { name: "Affection", ref: { scope: "saved", variableId: "sv-1" }, valueType: "number", defaultValue: 0 },
            { name: "Playthroughs", ref: { scope: "persistent", variableId: "pk-1" }, valueType: "number", defaultValue: undefined },
        ]);
    });
});

describe("buildStoryCommandContext - audio tracks", () => {
    afterEach(() => {
        commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
        i18nStore.setLocale("en");
    });

    const tracks = [
        ...BUILTIN_AUDIO_TRACKS,
        { id: "t_narra", name: "Narra", parentId: "voice", volume: 1, loop: false },
    ];

    function contextIn(locale: "en" | "zh") {
        i18nStore.setLocale(locale);
        const document = documentWith({});
        return buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document,
            sceneId: "scene-1",
            scene: document.scenes["scene-1"],
            audioTracks: tracks,
        });
    }

    it("offers a seeded track by the command language's word, and still answers to its stored name", () => {
        const context = contextIn("zh");
        expect(context.audioTracks.map(track => track.name)).toEqual(["音乐", "音效", "语音", "Narra"]);

        // A line typed before the words changed keeps naming the same track, and so does the new word.
        for (const word of ["Music", "音乐"]) {
            const line = parseCommandLine(`/bgm theme track=${word}`);
            if (line.kind !== "command") {
                throw new Error("not a command");
            }
            const resolved = resolveCommandLine(line, { ...context, audio: [{ id: "a1", name: "theme" }] });
            expect(resolved.issues).toEqual([]);
            expect(resolved.args.track).toEqual({ kind: "audioTrack", trackId: "bgm" });
        }
    });

    it("keeps a renamed seeded track's own name, and adds nothing in English", () => {
        expect(contextIn("en").audioTracks.map(track => [track.name, track.aliases])).toEqual([
            ["Music", undefined], ["SFX", undefined], ["Voice", undefined], ["Narra", undefined],
        ]);
        i18nStore.setLocale("zh");
        const document = documentWith({});
        const renamed = buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document,
            sceneId: "scene-1",
            scene: document.scenes["scene-1"],
            audioTracks: tracks.map(track => (track.id === "bgm" ? { ...track, name: "Score" } : track)),
        });
        expect(renamed.audioTracks[0]).toEqual({ id: "bgm", name: "Score" });
    });
});
