import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument, type StoryLibraryIndex } from "@shared/types/story";
import { AUDIO_TRACK_SCHEMA_VERSION } from "@shared/types/audioTrack";
import { createEmptyLocalizationDocument } from "@shared/types/localization";
import { VARIABLE_REGISTRY_SCHEMA_VERSION } from "@shared/types/variables/registry";
import { createEmptyVoiceDocument } from "@shared/types/voice";
import { createEmptyStoryDocument, createEmptyStoryLibraryIndex, createStoryLibraryEntry } from "@shared/story/storyModel";
import {
    applyProjectOp,
    assetBytesOf,
    fileBytesOf,
    isProjectDocumentPath,
    isTeamFilePath,
    isWholeFilePath,
    parseProjectFile,
    projectDocumentPath,
    projectOpClaimKeys,
    serializeProjectFile,
    STORY_LIBRARY_FILE,
    type KernelProjectView,
} from "./project";

const NOW = "2026-11-14T00:00:00.000Z";
const STORY = "00000000-0000-4000-8000-000000000001";
const STORY_PATH = `editor/story/stories/${STORY}/storydoc.json`;

function memory(files: Record<string, unknown>): KernelProjectView & { files: Map<string, unknown> } {
    const map = new Map(Object.entries(files));
    return {
        files: map,
        get: path => map.get(path),
        set: (path, value) => void map.set(path, value),
        delete: path => void map.delete(path),
    };
}

function story(id = STORY, firstId = 100): StoryDocument {
    let next = firstId;
    return createEmptyStoryDocument({
        id,
        name: "Story",
        now: NOW,
        generateId: () => `00000000-0000-4000-8000-${(++next).toString(16).padStart(12, "0")}`,
    });
}

function library(): StoryLibraryIndex {
    const index = createEmptyStoryLibraryIndex(NOW);
    index.stories.push(createStoryLibraryEntry({ id: STORY, name: "Story", documentPath: STORY_PATH, now: NOW }));
    return index;
}

function dialogue(id: string, characterId: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "dialogue", characterId, text: { textId: `t-${id}`, role: "dialogue", value: "hi" } },
    };
}

describe("a team project's documents", () => {
    it("knows which paths it holds", () => {
        expect(isProjectDocumentPath(STORY_PATH)).toBe(true);
        expect(isProjectDocumentPath(STORY_LIBRARY_FILE)).toBe(true);
        expect(isProjectDocumentPath("editor/localization/ja.json")).toBe(true);
        expect(isProjectDocumentPath("assets/assets.metadata.image.json")).toBe(true);
        expect(isProjectDocumentPath("assets/content/ab/cd/ef")).toBe(false);
        expect(isProjectDocumentPath(".nlstudio/services/panel_state.json")).toBe(false);
    });

    it("migrates an older story and retains an asset shard as stored", () => {
        const text = serializeProjectFile(STORY_PATH, story());
        expect(parseProjectFile(STORY_PATH, text)).toEqual(story());

        const old = structuredClone(story());
        const scene = old.scenes[old.chapters[0].sceneIds[0]];
        const row = (id: string, payload: Record<string, unknown>) => ({
            id, kind: "action", parentId: null, childrenIds: [], payload,
        }) as unknown as StoryBlock;
        scene.rootBlockIds = ["create", "play"];
        scene.blocks = {
            create: row("create", { action: "video", operation: "create", objectName: "intro", assetId: "clip" }),
            play: row("play", { action: "video", operation: "play", objectName: "intro" }),
        };
        const migrated = parseProjectFile(STORY_PATH, JSON.stringify({ ...old, schemaVersion: 26 })) as StoryDocument;
        expect(migrated.schemaVersion).toBe(STORY_DOCUMENT_SCHEMA_VERSION);
        expect(migrated.scenes[scene.id].rootBlockIds).toEqual(["play"]);
        expect(migrated.scenes[scene.id].blocks.play.payload).toMatchObject({ action: "video", operation: "play", assetId: "clip" });

        const shard = { "a1": { id: "a1", type: "image", name: "bg" } };
        expect(parseProjectFile("assets/assets.metadata.image.json", JSON.stringify(shard))).toEqual(shard);
    });

    it("makes and removes a whole story, library and document together", () => {
        const view = memory({ [STORY_LIBRARY_FILE]: library() });
        const other = "00000000-0000-4000-8000-000000000009";
        const otherPath = projectDocumentPath({ doc: "story", storyId: other });
        const made = applyProjectOp(view, { doc: "story", storyId: other }, {
            op: "create-story",
            entry: createStoryLibraryEntry({ id: other, name: "Side", documentPath: otherPath, now: NOW }),
            document: { ...story(), id: other, name: "Side" },
        }, { now: NOW });
        expect(made).toEqual({ changed: true, touched: [otherPath, STORY_LIBRARY_FILE] });
        expect((view.get(STORY_LIBRARY_FILE) as StoryLibraryIndex).stories.map(entry => entry.id)).toEqual([STORY, other]);
        expect(view.get(otherPath)).toMatchObject({ id: other, name: "Side" });
        expect(projectOpClaimKeys({ doc: "story", storyId: other }, { op: "delete-story" })).toEqual([`story:${other}`]);

        applyProjectOp(view, { doc: "story", storyId: other }, { op: "delete-story" }, { now: NOW });
        expect(view.get(otherPath)).toBeUndefined();
        expect((view.get(STORY_LIBRARY_FILE) as StoryLibraryIndex).stories.map(entry => entry.id)).toEqual([STORY]);
    });

    it("starts the story library with a project's first story", () => {
        // A project nobody has written a story in has no library file: the editor writes it lazily.
        const view = memory({});
        const first = "00000000-0000-4000-8000-000000000010";
        const firstPath = projectDocumentPath({ doc: "story", storyId: first });
        const made = applyProjectOp(view, { doc: "story", storyId: first }, {
            op: "create-story",
            entry: createStoryLibraryEntry({ id: first, name: "Main", documentPath: firstPath, now: NOW }),
            document: { ...story(), id: first, name: "Main" },
        }, { now: NOW });
        expect(made).toEqual({ changed: true, touched: [firstPath, STORY_LIBRARY_FILE] });
        expect((view.get(STORY_LIBRARY_FILE) as StoryLibraryIndex).stories.map(entry => entry.id)).toEqual([first]);
        expect(view.get(firstPath)).toMatchObject({ id: first, name: "Main" });
    });

    it("rewrites the rows a deleted character spoke, in every story", () => {
        const document = story();
        const scene = document.scenes[document.chapters[0].sceneIds[0]];
        scene.blocks.r1 = dialogue("r1", "alice");
        scene.blocks.r2 = dialogue("r2", "bob");
        scene.rootBlockIds.push("r1", "r2");
        const other = "00000000-0000-4000-8000-000000000009";
        const otherPath = projectDocumentPath({ doc: "story", storyId: other });
        const otherDocument = story(other, 200);
        otherDocument.name = "Side";
        const otherScene = otherDocument.scenes[otherDocument.chapters[0].sceneIds[0]];
        otherScene.blocks.r3 = dialogue("r3", "alice");
        otherScene.rootBlockIds.push("r3");
        const index = library();
        index.stories.push(createStoryLibraryEntry({ id: other, name: "Side", documentPath: otherPath, now: NOW }));
        const view = memory({
            [STORY_LIBRARY_FILE]: index,
            [STORY_PATH]: document,
            [otherPath]: otherDocument,
            "editor/services/character.json": { version: 1, characters: [{ profile: { id: "alice", name: "Alice" } }] },
        });
        const applied = applyProjectOp(view, { doc: "characters" }, { op: "delete-character", characterId: "alice" }, { now: NOW });
        expect(applied).toEqual({ changed: true, touched: ["editor/services/character.json", STORY_PATH, otherPath] });
        expect((view.get("editor/services/character.json") as { characters: unknown[] }).characters).toEqual([]);
        for (const [path, sceneId, blockId] of [[STORY_PATH, scene.id, "r1"], [otherPath, otherScene.id, "r3"]] as const) {
            const payload = (view.get(path) as StoryDocument).scenes[sceneId].blocks[blockId].payload;
            expect(payload).toMatchObject({ action: "dialogue", speakerName: "Alice" });
            expect(payload).not.toHaveProperty("characterId");
        }
        expect((view.get(STORY_PATH) as StoryDocument).scenes[scene.id].blocks.r2.payload).toEqual(dialogue("r2", "bob").payload);
    });

    it("writes translations and applies derived voice takes", () => {
        const previous = { target: "x", sourceHash: "old-hash", status: "translated" } as const;
        const translation = { target: "こんにちは", sourceHash: "source-hash", status: "translated" } as const;
        const take = { assetId: "v1", sourceHash: "source-hash", status: "linked" } as const;
        const view = memory({
            "editor/localization/ja.json": { ...createEmptyLocalizationDocument("ja"), units: { old: previous } },
            "editor/voice/ja.json": createEmptyVoiceDocument("ja"),
        });
        applyProjectOp(view, { doc: "localization", locale: "ja" }, { op: "set-translation", locale: "ja", unitId: "old", unit: null }, { now: NOW });
        const applied = applyProjectOp(
            view,
            { doc: "localization", locale: "ja" },
            { op: "set-translations", locale: "ja", units: [{ unitId: "t1", unit: translation }] },
            { now: NOW },
            { voice: { ja: { t1: take } } },
        );
        expect(applied.touched).toEqual(["editor/localization/ja.json", "editor/voice/ja.json"]);
        expect(view.get("editor/localization/ja.json")).toEqual({ ...createEmptyLocalizationDocument("ja"), units: { t1: translation } });
        expect(view.get("editor/voice/ja.json")).toEqual({ ...createEmptyVoiceDocument("ja"), units: { t1: take } });
    });

    it("orders colours, promotes child tracks and edits the variable registry", () => {
        const variable = { id: "v1", name: "score", scope: "persistent", valueType: "number", storageKey: "score" } as const;
        const view = memory({
            "editor/brand.json": { colors: [{ id: "a", name: "A", value: "#000000" }, { id: "b", name: "B", value: "#ffffff" }] },
            "editor/audio-tracks.json": { schemaVersion: AUDIO_TRACK_SCHEMA_VERSION, tracks: [{ id: "group", name: "Group", parentId: null, volume: 1, loop: true }, { id: "theme", name: "Theme", parentId: "group", volume: 1, loop: true }] },
            "editor/variables.json": { schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION, entries: {} },
        });
        applyProjectOp(view, { doc: "brand" }, { op: "move-brand-color", colorId: "b", beforeId: "a" }, { now: NOW });
        const ids = (view.get("editor/brand.json") as { colors: Array<{ id: string }> }).colors.map(color => color.id);
        expect(ids.filter(id => id === "a" || id === "b")).toEqual(["b", "a"]);

        applyProjectOp(view, { doc: "audio-tracks" }, { op: "delete-audio-track", trackId: "group" }, { now: NOW });
        const tracks = (view.get("editor/audio-tracks.json") as { tracks: Array<{ id: string; parentId: string | null }> }).tracks;
        expect(tracks.find(track => track.id === "group")).toBeUndefined();
        expect(tracks.find(track => track.id === "theme")).toMatchObject({ id: "theme", parentId: null });

        applyProjectOp(view, { doc: "variables" }, { op: "create-variable", entry: variable }, { now: NOW });
        expect(view.get("editor/variables.json")).toEqual({ schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION, entries: { v1: variable } });
        expect(applyProjectOp(view, { doc: "variables" }, { op: "delete-variable", variableId: "nope" }, { now: NOW }).changed).toBe(false);
    });

    it("deletes a folder with what is filed in it, across the section's types", () => {
        const view = memory({
            "assets/assets.groups.media.json": { f1: { id: "f1", name: "Music" }, f2: { id: "f2", name: "Battle", parentGroupId: "f1" } },
            "assets/assets.metadata.audio.json": { a1: { id: "a1", type: "audio", groupId: "f2" }, a2: { id: "a2", type: "audio" } },
            "assets/assets.metadata.video.json": { v1: { id: "v1", type: "video", groupId: "f1" } },
        });
        const applied = applyProjectOp(view, { doc: "asset-groups", category: "media" }, { op: "delete-asset-folder", category: "media", folderId: "f1", recursive: true }, { now: NOW });
        expect(applied.touched.sort()).toEqual(["assets/assets.groups.media.json", "assets/assets.metadata.audio.json", "assets/assets.metadata.video.json"]);
        expect(view.get("assets/assets.groups.media.json")).toEqual({});
        expect(view.get("assets/assets.metadata.audio.json")).toEqual({ a2: { id: "a2", type: "audio" } });
        expect(view.get("assets/assets.metadata.video.json")).toEqual({});
    });

    it("names the transfers an asset operation brings", () => {
        expect(assetBytesOf({
            op: "create-assets",
            assetType: "image",
            creates: [{ record: { id: "a1", type: "image", name: "Backdrop" }, bytes: { from: "transfer", parts: [{ path: null, transferId: "t1", size: 3, digest: "d" }] } }],
        })).toEqual([{ assetType: "image", assetId: "a1", transferId: "t1", path: null, size: 3, digest: "d" }]);
    });

    it("refuses a verb it does not know rather than doing nothing", () => {
        const view = memory({ "editor/variables.json": { entries: {} } });
        expect(() => applyProjectOp(view, { doc: "variables" }, { op: "nonsense" } as never, { now: NOW })).toThrow(/does not know/);
    });

    it("names the structure an operation writes, so offline reshaping collides too", () => {
        const doc = { doc: "story", storyId: STORY } as const;
        expect(projectOpClaimKeys(doc, { op: "rename-scene", sceneId: "s1", name: "x" })).toEqual(["scene:s1"]);
        expect(projectOpClaimKeys(doc, { op: "delete-chapter", chapterId: "c1" })).toEqual(expect.arrayContaining(["chapter:c1"]));
        expect(projectOpClaimKeys(doc, { op: "rename-story", name: "x" })).toEqual([`story:${STORY}`]);
        expect(projectOpClaimKeys(doc, { op: "update-block", sceneId: "s1", blockId: "b1", payload: dialogue("b1", "alice").payload })).toEqual(["row:b1"]);
    });

    describe("whole files", () => {
        const DIGEST = "a".repeat(64);

        it("tells the files that only travel whole from the documents and the rest", () => {
            expect(isWholeFilePath("editor/save-schema.json")).toBe(true);
            expect(isWholeFilePath("editor/story/animations/a.json")).toBe(true);
            expect(isWholeFilePath("demo.nlproj")).toBe(true);
            expect(isWholeFilePath("editor/variables.json")).toBe(false);
            expect(isWholeFilePath("assets/content/aa/bb/cc")).toBe(false);
            expect(isTeamFilePath("editor/variables.json")).toBe(true);
            expect(isTeamFilePath("assets/content/aa/bb/cc")).toBe(true);
            expect(isTeamFilePath(STORY_PATH)).toBe(false);
            expect(isTeamFilePath(STORY_LIBRARY_FILE)).toBe(false);
            expect(isTeamFilePath("editor/story-comments.json")).toBe(false);
            expect(isTeamFilePath(".nlstudio/services/x.json")).toBe(false);
            expect(isTeamFilePath(".loreignore")).toBe(false);
        });

        it("puts, replaces and removes a file, and says when nothing changed", () => {
            const view = memory({});
            const doc = { doc: "file", path: "editor/save-schema.json" } as const;
            const put = (data: string) => applyProjectOp(view, doc, { op: "put-file", content: { encoding: "utf8", data } }, { now: NOW });
            expect(put("{}")).toEqual({ changed: true, touched: ["editor/save-schema.json"] });
            expect(view.files.get("editor/save-schema.json")).toEqual({ $file: 1, encoding: "utf8", data: "{}" });
            expect(put("{}")).toEqual({ changed: false, touched: [] });
            expect(put("{\"version\":1}")).toEqual({ changed: true, touched: ["editor/save-schema.json"] });
            expect(view.files.get("editor/save-schema.json")).toEqual({ $file: 1, encoding: "utf8", data: "{\"version\":1}" });
            expect(applyProjectOp(view, doc, { op: "put-file", content: null }, { now: NOW }).changed).toBe(true);
            expect(view.files.has("editor/save-schema.json")).toBe(false);
            expect(applyProjectOp(view, doc, { op: "put-file", content: null }, { now: NOW }).changed).toBe(false);
        });

        it("validates a whole-document write and holds the parsed document", () => {
            const view = memory({});
            const doc = { doc: "file", path: "editor/variables.json" } as const;
            expect(() => applyProjectOp(view, doc, { op: "put-file", content: { encoding: "utf8", data: "not json" } }, { now: NOW })).toThrow();
            expect(() => applyProjectOp(view, doc, { op: "put-file", content: { encoding: "base64", data: "AA==" } }, { now: NOW })).toThrow(/as text/);
            const registry = {
                schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION,
                entries: { gold: { id: "gold", name: "Gold", scope: "persistent", valueType: "number", storageKey: "gold" } },
            };
            expect(applyProjectOp(view, doc, { op: "put-file", content: { encoding: "utf8", data: JSON.stringify(registry) } }, { now: NOW }))
                .toEqual({ changed: true, touched: ["editor/variables.json"] });
            expect(view.get("editor/variables.json")).toEqual(registry);
        });

        it("refuses a path that is not shared, and names a transfer's bytes", () => {
            const view = memory({});
            expect(() => applyProjectOp(view, { doc: "file", path: STORY_PATH }, { op: "put-file", content: null }, { now: NOW })).toThrow(/not a file/);
            const doc = { doc: "file", path: "icon.png" } as const;
            const op = { op: "put-file", content: { blob: { transferId: "t1", digest: DIGEST, size: 9 } } } as const;
            expect(applyProjectOp(view, doc, op, { now: NOW }).changed).toBe(true);
            expect(fileBytesOf(doc, op)).toEqual({ path: "icon.png", transferId: "t1", digest: DIGEST, size: 9 });
            expect(projectOpClaimKeys(doc, op)).toEqual(["file:icon.png"]);
        });
    });
});
