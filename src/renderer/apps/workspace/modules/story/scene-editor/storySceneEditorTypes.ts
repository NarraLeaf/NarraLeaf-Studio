import type { StoryBlock, StoryBlockId, StoryRichRun } from "@shared/types/story";

export type StoryBlockTarget = {
    parentId: StoryBlockId | null;
    beforeBlockId?: StoryBlockId | null;
};

export type VisibleStoryRow = {
    block: StoryBlock;
    depth: number;
    lineNumber: number;
};

export type InsertSlot = {
    afterBlockId: StoryBlockId | null;
    focusToken: number;
};

export type EditorMode =
    | { kind: "idle" }
    | { kind: "text"; blockId: StoryBlockId; value: string; rich?: StoryRichRun[]; caret?: "start" | "end" }
    | { kind: "insert"; slot: InsertSlot; value: string; chooser: "none" | "action" | "character" }
    | { kind: "inspector"; blockId: StoryBlockId };

export type SerializedStoryBlock = {
    block: StoryBlock;
    children: SerializedStoryBlock[];
};

export type StoryClipboardPayload = {
    version: 1;
    kind: "narraleaf.story.actions";
    roots: SerializedStoryBlock[];
};
