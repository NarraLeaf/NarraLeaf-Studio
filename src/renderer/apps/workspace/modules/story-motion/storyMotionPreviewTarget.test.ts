import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";

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
