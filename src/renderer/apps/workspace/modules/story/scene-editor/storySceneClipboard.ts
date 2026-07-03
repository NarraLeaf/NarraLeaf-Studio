import type { StoryBlock, StoryBlockId, StoryScene, StoryTextSegment } from "@shared/types/story";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { Character } from "@/lib/workspace/services/character/Character";
import { describeBlock, getBlockBadgeInfo, getCharacterName } from "./storySceneBlockUtils";
import type { SerializedStoryBlock, StoryBlockTarget, StoryClipboardPayload, VisibleStoryRow } from "./storySceneEditorTypes";

export const STORY_ACTIONS_MIME = "application/x-narraleaf-story-actions";

export function serializeBlockSubtree(scene: StoryScene, blockId: StoryBlockId): SerializedStoryBlock {
    const block = scene.blocks[blockId];
    return {
        block: structuredCloneBlock(block),
        children: block.childrenIds.map(childId => serializeBlockSubtree(scene, childId)),
    };
}

export function cloneSerializedBlock(source: SerializedStoryBlock, generateId: () => string): SerializedStoryBlock {
    const block = structuredCloneBlock(source.block);
    block.id = generateId();
    block.parentId = null;
    block.childrenIds = [];
    block.payload = clonePayloadWithNewTextIds(block.payload, generateId);
    return {
        block,
        children: source.children.map(child => cloneSerializedBlock(child, generateId)),
    };
}

export function insertSerializedClone(
    storyService: StoryService,
    storyId: string,
    sceneId: string,
    source: SerializedStoryBlock,
    target: StoryBlockTarget,
): void {
    storyService.insertBlock(storyId, sceneId, source.block, target);
    for (const child of source.children) {
        insertSerializedClone(storyService, storyId, sceneId, child, { parentId: source.block.id });
    }
}

export function exportBlockPlainText(block: StoryBlock, characters: Character[]): string {
    if (block.kind === "nodeAction") {
        if (block.payload.action === "dialogue") {
            return `${getCharacterName(characters, block.payload.characterId)} - ${block.payload.text.value}`;
        }
        if ("text" in block.payload) {
            return block.payload.text.value;
        }
        if ("prompt" in block.payload) {
            return block.payload.prompt?.value ?? "[choice]";
        }
    }
    if (block.kind === "note") {
        return block.payload.text.value;
    }
    return `[${getBlockBadgeInfo(block).label}] ${describeBlock(block, characters)}`;
}

export function parseDialogueLine(line: string, characters: Character[]): { characterId: string; text: string } | null {
    const match = line.match(/^([^:\uFF1A\-\u2014]{1,64})\s*[:\uFF1A\-\u2014]\s*(.+)$/);
    if (!match) {
        return null;
    }
    const speaker = match[1].trim().toLowerCase();
    const character = characters.find(item => {
        const profile = item.profile;
        return profile.getName().toLowerCase() === speaker || profile.getNicknames().some(name => name.toLowerCase() === speaker);
    });
    return character ? { characterId: character.profile.getId(), text: match[2] } : null;
}

export function getPasteAnchorId(
    rows: VisibleStoryRow[],
    selectedBlockIds: Set<StoryBlockId>,
    activeBlockId: StoryBlockId | null,
): StoryBlockId | null {
    if (selectedBlockIds.size === 0) {
        return activeBlockId;
    }
    let anchor: VisibleStoryRow | null = null;
    for (const row of rows) {
        if (selectedBlockIds.has(row.block.id)) {
            anchor = row;
        }
    }
    return anchor?.block.id ?? activeBlockId;
}

export function isStoryClipboardPayload(payload: StoryClipboardPayload): payload is StoryClipboardPayload {
    return payload.kind === "narraleaf.story.actions" && payload.roots.length > 0;
}

function structuredCloneBlock(block: StoryBlock): StoryBlock {
    return JSON.parse(JSON.stringify(block)) as StoryBlock;
}

function clonePayloadWithNewTextIds(payload: StoryBlock["payload"], generateId: () => string): StoryBlock["payload"] {
    const clone = JSON.parse(JSON.stringify(payload)) as StoryBlock["payload"];
    const replaceTextId = (text: StoryTextSegment | string | undefined) => {
        if (isStoryTextSegment(text)) {
            text.textId = generateId();
        }
    };
    if ("text" in clone) {
        replaceTextId(clone.text);
    }
    if ("prompt" in clone) {
        replaceTextId(clone.prompt);
    }
    return clone;
}

function isStoryTextSegment(value: unknown): value is StoryTextSegment {
    return Boolean(value && typeof value === "object" && "textId" in value && "value" in value);
}
