import { describe, expect, it } from "vitest";
import type { StoryActionPayload, StoryBlock, StoryDocument } from "@shared/types/story";
import { resolveDisplayableTargetRef } from "@shared/types/story";
import { listSceneDisplayableTargets, resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";

function documentWith(blocks: Record<string, StoryBlock>, rootBlockIds: string[]): StoryDocument {
    return {
        schemaVersion: 1,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Scene",
                runtimeName: "scene",
                rootBlockIds,
                blocks,
            },
        },
    };
}

describe("resolveStoryMotionPreviewTarget", () => {
    it("uses current text action data for text previews", () => {
        const document = documentWith({
            text: {
                id: "text",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "text",
                    operation: "create",
                    objectName: "caption",
                    text: "Hello",
                    fontSize: 28,
                    fontColor: "#ffcc00",
                },
            },
        }, ["text"]);

        const target = resolveStoryMotionPreviewTarget({
            document,
            sceneId: "scene-1",
            blockId: "text",
            fallbackKind: "image",
            fallbackLabel: "Fallback",
        });

        expect(target).toEqual(expect.objectContaining({
            kind: "text",
            label: "caption",
            text: "Hello",
            fontSize: 28,
            fontColor: "#ffcc00",
        }));
    });

    it("falls back to the preview image only when no target asset resolves", () => {
        const standalone = resolveStoryMotionPreviewTarget({
            document: null,
            sceneId: undefined,
            blockId: undefined,
            fallbackKind: "image",
            fallbackLabel: "Motion",
            previewAssetId: "asset-preview",
        });
        expect(standalone.assetId).toBe("asset-preview");

        const document = documentWith({
            create: {
                id: "create",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "image",
                    operation: "create",
                    objectName: "hero",
                    assetId: "asset-hero",
                },
            },
            move: {
                id: "move",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                },
            },
        }, ["create", "move"]);
        const bound = resolveStoryMotionPreviewTarget({
            document,
            sceneId: "scene-1",
            blockId: "move",
            fallbackKind: "image",
            fallbackLabel: "Motion",
            previewAssetId: "asset-preview",
        });
        expect(bound.assetId).toBe("asset-hero");
    });

    it("looks backward for displayable image preview context", () => {
        const document = documentWith({
            create: {
                id: "create",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "image",
                    operation: "create",
                    objectName: "hero",
                    assetId: "asset-hero",
                },
            },
            move: {
                id: "move",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                },
            },
        }, ["create", "move"]);

        const target = resolveStoryMotionPreviewTarget({
            document,
            sceneId: "scene-1",
            blockId: "move",
            fallbackKind: "image",
            fallbackLabel: "Fallback",
        });

        expect(target).toEqual(expect.objectContaining({
            kind: "image",
            label: "hero",
            assetId: "asset-hero",
        }));
    });
});

describe("listSceneDisplayableTargets", () => {
    function action(id: string, payload: StoryActionPayload): StoryBlock {
        return { id, kind: "action", parentId: null, childrenIds: [], payload };
    }

    it("lists creator displayables with their stable source block, deduped with the latest asset", () => {
        const document = documentWith({
            hero: action("hero", { action: "image", operation: "create", objectName: "hero", assetId: "asset-hero" }),
            heroReskin: action("heroReskin", { action: "image", operation: "setSource", objectName: "hero", assetId: "asset-hero-2" }),
            caption: action("caption", { action: "text", operation: "create", objectName: "caption", text: "Hi" }),
            move: action("move", { action: "displayable", operation: "transform", target: { name: "hero", kind: "image" } }),
        }, ["hero", "heroReskin", "caption", "move"]);

        const targets = listSceneDisplayableTargets(document, "scene-1", "move");

        // Deduped by identity: latest asset wins, but the source stays the first creator ("hero").
        expect(targets).toEqual([
            { kind: "image", name: "hero", assetId: "asset-hero-2", sourceBlockId: "hero" },
            { kind: "text", name: "caption", text: "Hi", sourceBlockId: "caption" },
        ]);
    });

    it("excludes the current block and anything after it", () => {
        const document = documentWith({
            hero: action("hero", { action: "image", operation: "create", objectName: "hero", assetId: "asset-hero" }),
            later: action("later", { action: "image", operation: "create", objectName: "later", assetId: "asset-later" }),
        }, ["hero", "later"]);

        expect(listSceneDisplayableTargets(document, "scene-1", "hero")).toEqual([]);
        expect(listSceneDisplayableTargets(document, "scene-1", "later")).toEqual([
            { kind: "image", name: "hero", assetId: "asset-hero", sourceBlockId: "hero" },
        ]);
    });

    it("lists only creator actions, never displayable references (which introduce nothing)", () => {
        const document = documentWith({
            ghostShow: action("ghostShow", { action: "displayable", operation: "show", target: { name: "ghost" } }),
            ghostMove: action("ghostMove", { action: "displayable", operation: "transform", target: { name: "ghost", kind: "image" } }),
            probe: action("probe", { action: "displayable", operation: "hide", target: { name: "ghost" } }),
        }, ["ghostShow", "ghostMove", "probe"]);

        expect(listSceneDisplayableTargets(document, "scene-1", "probe")).toEqual([]);
    });
});

describe("resolveDisplayableTargetRef", () => {
    function action(id: string, payload: StoryActionPayload): StoryBlock {
        return { id, kind: "action", parentId: null, childrenIds: [], payload };
    }

    it("follows the source block's current name when the stage name is renamed", () => {
        // The creator was renamed to "protagonist"; the target still carries the stale name "hero".
        const scene = documentWith({
            hero: action("hero", { action: "image", operation: "create", objectName: "protagonist", assetId: "asset-hero" }),
        }, ["hero"]).scenes["scene-1"];

        expect(resolveDisplayableTargetRef(scene, { name: "hero", kind: "image", sourceBlockId: "hero" }))
            .toEqual({ name: "protagonist", kind: "image" });
    });

    it("falls back to the stored name when the source block is gone", () => {
        const scene = documentWith({}, []).scenes["scene-1"];
        expect(resolveDisplayableTargetRef(scene, { name: "ghost", kind: "image", sourceBlockId: "deleted" }))
            .toEqual({ name: "ghost", kind: "image" });
    });

    it("uses the stored name/kind for legacy targets without a source block", () => {
        const scene = documentWith({}, []).scenes["scene-1"];
        expect(resolveDisplayableTargetRef(scene, { name: "hero", kind: "character" }))
            .toEqual({ name: "hero", kind: "character" });
    });
});
