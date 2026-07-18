import { describe, expect, it } from "vitest";
import type { StoryActionPayload, StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { buildStoryCommandContext } from "./storyCommandContext";

/** One action block per line, in root order — enough to exercise the stage-object collection. */
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

describe("buildStoryCommandContext — stage objects", () => {
    it("collects the named objects an author can reference, per kind", () => {
        const document = documentWith({
            b1: { action: "image", operation: "create", objectName: "hero", assetId: "img-1" },
            b2: { action: "text", operation: "create", objectName: "title", text: "Hi" },
            b3: { action: "layer", operation: "create", objectName: "fx" },
            b4: { action: "video", operation: "create", objectName: "clip", assetId: "vid-1" },
            b5: { action: "audio", operation: "playSound", objectName: "music", assetId: "aud-1" },
        });

        const context = buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document,
            sceneId: "scene-1",
            scene: document.scenes["scene-1"],
        });

        // This is what makes `/imgshow`, `/settext`, `/vidshow`, `/stop` a pick rather than a guess —
        // image/text/layer via the shared displayable collector, video/audio scanned off the scene.
        expect(context.stageObjects.image).toEqual(["hero"]);
        expect(context.stageObjects.text).toEqual(["title"]);
        expect(context.stageObjects.layer).toEqual(["fx"]);
        expect(context.stageObjects.video).toEqual(["clip"]);
        expect(context.stageObjects.audio).toEqual(["music"]);
    });

    it("is empty, not undefined, when there is no scene", () => {
        const context = buildStoryCommandContext({ assets: undefined, characters: [], document: null, sceneId: null, scene: null });
        expect(context.stageObjects).toEqual({ image: [], text: [], layer: [], video: [], audio: [] });
    });
});
