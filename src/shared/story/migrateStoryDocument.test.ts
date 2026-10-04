import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument } from "@shared/types/story";
import { migrateStoryDocumentToLatest } from "./migrateStoryDocument";

/**
 * v26→v27: `play` becomes the only row that brings a clip on, and every play carries its file.
 *
 * The rows are built loosely on purpose: a v26 document holds `create` and `show` video rows, which the
 * current type no longer has.
 */

const SCENE_ID = "scene-1";

function row(id: string, payload: Record<string, unknown>, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind: "action", parentId, childrenIds, payload } as unknown as StoryBlock;
}

function v26(blocks: StoryBlock[], rootBlockIds: string[] = blocks.filter(block => block.parentId === null).map(block => block.id)): StoryDocument {
    return {
        schemaVersion: 26,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: [SCENE_ID] }],
        scenes: {
            [SCENE_ID]: {
                id: SCENE_ID,
                name: "Scene",
                runtimeName: "scene",
                rootBlockIds,
                blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
            },
        },
    } as unknown as StoryDocument;
}

function migrated(blocks: StoryBlock[], rootBlockIds?: string[]) {
    const document = migrateStoryDocumentToLatest(v26(blocks, rootBlockIds));
    const scene = document.scenes[SCENE_ID];
    return { document, scene, block: (id: string) => scene.blocks[id] as unknown as { kind: string; payload: Record<string, any> } | undefined };
}

describe("v26 to v27: plays carry their clips", () => {
    it("stamps the current version", () => {
        expect(migrated([]).document.schemaVersion).toBe(STORY_DOCUMENT_SCHEMA_VERSION);
    });

    it("folds a clip's create and show rows into the play that follows them", () => {
        const { scene, block } = migrated([
            row("create", { action: "video", operation: "create", objectName: "intro", assetId: "asset-intro", muted: true }),
            row("show", { action: "video", operation: "show", objectName: "intro" }),
            row("play", { action: "video", operation: "play", objectName: "intro", target: { name: "intro", sourceBlockId: "create" } }),
            row("pause", { action: "video", operation: "pause", objectName: "intro", target: { name: "intro", label: "intro", sourceBlockId: "create" } }),
        ]);

        expect(scene.rootBlockIds).toEqual(["play", "pause"]);
        expect(block("create")).toBeUndefined();
        expect(block("show")).toBeUndefined();
        // The play defines the clip now: file, name and mute flag, and no reference to a row that went.
        expect(block("play")?.payload).toEqual({ action: "video", operation: "play", objectName: "intro", assetId: "asset-intro", muted: true });
        // The row addressing the clip is bound to the play that defines it.
        expect(block("pause")?.payload.target).toEqual({ name: "intro", label: "intro", sourceBlockId: "play" });
    });

    it("gives every play of a clip that clip's file, and adds nothing about hiding", () => {
        const { block } = migrated([
            row("play-own", { action: "video", operation: "play", objectName: "intro", assetId: "asset-intro" }),
            row("again", { action: "video", operation: "play", objectName: "intro" }),
        ]);
        expect(block("play-own")?.payload).toEqual({ action: "video", operation: "play", objectName: "intro", assetId: "asset-intro" });
        // The hold a name-only play used to keep was never wanted, so the new default stands.
        expect(block("again")?.payload).toEqual({ action: "video", operation: "play", objectName: "intro", assetId: "asset-intro" });
    });

    it("folds into a play inside a branch, and removes the folded row from the parent it sat in", () => {
        const { scene, block } = migrated([
            row("group", { control: "sequence", mode: "do" }, null, ["create", "play"]),
            row("create", { action: "video", operation: "create", objectName: "intro", assetId: "asset-intro" }, "group"),
            row("play", { action: "video", operation: "play", objectName: "intro" }, "group"),
        ].map(block => (block.id === "group" ? { ...block, kind: "control" } as StoryBlock : block)), ["group"]);
        expect(scene.blocks.group.childrenIds).toEqual(["play"]);
        expect(block("play")?.payload.assetId).toBe("asset-intro");
    });

    it("turns what can no longer be said into notes quoting the line", () => {
        const { scene, block } = migrated([
            // Declared and shown, never played.
            row("never", { action: "video", operation: "create", objectName: "poster clip", muted: true }),
            row("never-show", { action: "video", operation: "show", objectName: "poster clip" }),
            // A row reaching a clip before the play that now brings it on.
            row("early", { action: "video", operation: "seek", objectName: "intro", timeMs: 1500 }),
            row("intro", { action: "video", operation: "play", objectName: "intro", assetId: "asset-intro" }),
            // A row addressing a clip nothing plays.
            row("ghost", { action: "video", operation: "hide", objectName: "ghost", durationMs: 400 }),
            row("ghost-play", { action: "video", operation: "play", objectName: "phantom" }),
        ]);

        // Every row keeps its place.
        expect(scene.rootBlockIds).toEqual(["never", "never-show", "early", "intro", "ghost", "ghost-play"]);
        const note = (id: string) => {
            const found = block(id);
            expect(found?.kind).toBe("note");
            return found?.payload.text.value;
        };
        expect(note("never")).toBe("/video name='poster clip' muted");
        expect(note("never-show")).toBe("/show 'poster clip'");
        expect(note("early")).toBe("/seek intro 1.5");
        expect(note("ghost")).toBe("/hide ghost out=fade d=0.4");
        expect(note("ghost-play")).toBe("/play phantom");
        expect(block("intro")?.kind).toBe("action");
    });

    it("gives every play the clip it played before the step", () => {
        const { block } = migrated([
            // Above every declaration of its clip: it played nothing, so it says so as a note.
            row("too-early", { action: "video", operation: "play", objectName: "intro" }),
            row("create", { action: "video", operation: "create", objectName: "intro", assetId: "asset-first" }),
            // Named a second file under the same name: the first clip is what played.
            row("other-file", { action: "video", operation: "play", objectName: "intro", assetId: "asset-second" }),
        ]);
        expect(block("too-early")?.kind).toBe("note");
        expect(block("other-file")?.payload).toEqual({ action: "video", operation: "play", objectName: "intro", assetId: "asset-first" });
        expect(block("create")).toBeUndefined();
    });

    it("lets a disabled row declare nothing, and keeps it disabled as a note", () => {
        const disabledCreate = { ...row("off", { action: "video", operation: "create", objectName: "intro", assetId: "asset-intro" }), disabled: true } as StoryBlock;
        const { block } = migrated([
            disabledCreate,
            row("play", { action: "video", operation: "play", objectName: "intro" }),
        ]);
        expect(block("off")).toMatchObject({ kind: "note", disabled: true });
        expect(block("play")?.kind).toBe("note");
    });

    it("leaves a document with no clips exactly as it was, apart from the stamp", () => {
        const before = v26([row("bg", { action: "setBackground", assetId: "asset-bg" })]);
        const after = migrateStoryDocumentToLatest(before);
        expect(after.scenes[SCENE_ID]).toBe(before.scenes[SCENE_ID]);
    });
});
