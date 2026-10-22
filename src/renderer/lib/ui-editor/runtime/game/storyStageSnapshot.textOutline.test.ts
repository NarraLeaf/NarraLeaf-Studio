import { describe, expect, it } from "vitest";
import type { StoryActionPayload, StoryBlock, StoryDocument } from "@shared/types/story";
import { computeStoryStageSnapshot } from "./storyStageSnapshot";

/**
 * A `/font` outline settles into the text's pose, on the `filter` channel the runtime draws it on,
 * so a row-precise launch rebuilds the text with the outline it had at that row.
 */

function action(id: string, payload: Extract<StoryActionPayload, { action: "text" }>): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload } as StoryBlock;
}

function snapshotAt(blocks: StoryBlock[], targetBlockId: string) {
    const document = {
        id: "story",
        name: "Story",
        chapters: [{ id: "ch", name: "Chapter", sceneIds: ["scene"] }],
        scenes: {
            scene: {
                id: "scene",
                name: "Credits",
                rootBlockIds: blocks.map(block => block.id),
                blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
            },
        },
    } as unknown as StoryDocument;
    return computeStoryStageSnapshot({ document, sceneId: "scene", targetBlockId });
}

describe("text outline in the stage snapshot", () => {
    const create = action("create", { action: "text", operation: "create", objectName: "credit", text: "Staff" });
    const font = action("font", {
        action: "text",
        operation: "setFont",
        objectName: "credit",
        fontSize: 48,
        fontColor: "#FFFFFF",
        outline: { width: 1, color: "#332e3e" },
    });
    const clear = action("clear", { action: "text", operation: "setFont", objectName: "credit", outline: null });

    it("records the size, the colour and the outline a setFont row states", () => {
        const record = snapshotAt([create, font, action("end", { action: "text", operation: "show", objectName: "credit" })], "end")
            .displayables.find(entry => entry.objectName === "credit");
        expect(record).toMatchObject({ fontSize: 48, fontColor: "#FFFFFF" });
        expect(record?.props.filter).toBe(
            "drop-shadow(1px 0 0 #332e3e) drop-shadow(-1px 0 0 #332e3e) drop-shadow(0 1px 0 #332e3e) drop-shadow(0 -1px 0 #332e3e)",
        );
    });

    it("clears the channel after outline=0", () => {
        const record = snapshotAt([create, font, clear, action("end", { action: "text", operation: "show", objectName: "credit" })], "end")
            .displayables.find(entry => entry.objectName === "credit");
        expect(record?.props.filter).toBe("none");
        expect(record?.fontSize).toBe(48);
    });
});
