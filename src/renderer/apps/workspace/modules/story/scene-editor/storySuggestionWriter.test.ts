import { describe, expect, it, vi } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";

import { suggestionWriter } from "./StoryRowCommentMark";

const dialogue: StoryBlock = {
    id: "row",
    parentId: null,
    childrenIds: [],
    kind: "nodeAction",
    payload: { action: "dialogue", speakerName: "Ada", text: { textId: "row-text", role: "dialogue", value: "Hello." } },
};

function storyWith(block: StoryBlock | undefined) {
    const updateBlock = vi.fn();
    const service = {
        getStoryDocument: () => ({ scenes: { scene: { blocks: block ? { [block.id]: block } : {} } } }),
        updateBlock,
    } as unknown as StoryService;
    return { service, updateBlock };
}

describe("writing a suggestion into its row", () => {
    it("replaces the line of text and keeps the rest of the row", () => {
        const { service, updateBlock } = storyWith(dialogue);
        const write = suggestionWriter(service, { storyId: "s", sceneId: "scene", blockId: "row" })!;
        expect(write("Hello there!")).toBe(true);
        const [, , blockId, payload] = updateBlock.mock.calls[0]!;
        expect(blockId).toBe("row");
        expect(payload).toMatchObject({ action: "dialogue", speakerName: "Ada", text: { textId: "row-text", value: "Hello there!" } });
    });

    it("offers nothing for a row that is gone, or with no story service", () => {
        expect(suggestionWriter(storyWith(undefined).service, { storyId: "s", sceneId: "scene", blockId: "row" })).toBeNull();
        expect(suggestionWriter(null, { storyId: "s", sceneId: "scene", blockId: "row" })).toBeNull();
    });
});
