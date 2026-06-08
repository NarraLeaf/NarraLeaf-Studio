import { Clock, Code, FileText, GitBranch, Image, MessageSquare, Music, Route, Settings2, StickyNote, UserRound, Variable } from "lucide-react";
import type { StoryBlock, StoryBlockId, StoryScene, StoryTextSegment } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { StoryBlockTarget, VisibleStoryRow } from "./storySceneEditorTypes";

export function buildVisibleRows(scene: StoryScene, collapsedIds: Set<StoryBlockId>): VisibleStoryRow[] {
    const rows: VisibleStoryRow[] = [];
    const visit = (blockId: StoryBlockId, depth: number) => {
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        rows.push({ block, depth, lineNumber: rows.length + 1 });
        if (!collapsedIds.has(blockId)) {
            block.childrenIds.forEach(childId => visit(childId, depth + 1));
        }
    };
    scene.rootBlockIds.forEach(blockId => visit(blockId, 0));
    return rows;
}

export function getTextSegment(block: StoryBlock): StoryTextSegment | null {
    if (block.kind === "note") {
        return block.payload.text;
    }
    if (block.kind !== "nodeAction") {
        return null;
    }
    if ("text" in block.payload) {
        return block.payload.text;
    }
    if ("prompt" in block.payload) {
        return block.payload.prompt ?? null;
    }
    return null;
}

export function updateTextPayload(block: StoryBlock, value: string): StoryBlock["payload"] | null {
    if (block.kind === "note") {
        return { ...block.payload, text: { ...block.payload.text, value } };
    }
    if (block.kind !== "nodeAction") {
        return null;
    }
    if ("text" in block.payload) {
        return { ...block.payload, text: { ...block.payload.text, value } };
    }
    if (block.payload.action === "choice" && block.payload.prompt) {
        return { ...block.payload, prompt: { ...block.payload.prompt, value } };
    }
    return null;
}

export function getInsertionTargetAfter(scene: StoryScene, afterBlockId: StoryBlockId | null): StoryBlockTarget {
    if (!afterBlockId) {
        return { parentId: null };
    }
    const block = scene.blocks[afterBlockId];
    if (!block) {
        return { parentId: null };
    }
    const siblings = block.parentId ? scene.blocks[block.parentId]?.childrenIds : scene.rootBlockIds;
    if (!siblings) {
        return { parentId: block.parentId };
    }
    const index = siblings.indexOf(afterBlockId);
    if (index === -1) {
        return { parentId: block.parentId };
    }
    return { parentId: block.parentId, beforeBlockId: siblings[index + 1] ?? null };
}

export function getMoveTargetAfter(scene: StoryScene, movingBlockId: StoryBlockId, afterBlockId: StoryBlockId | null): StoryBlockTarget {
    if (!afterBlockId) {
        return { parentId: null };
    }
    const block = scene.blocks[afterBlockId];
    if (!block) {
        return { parentId: null };
    }
    const siblings = block.parentId ? scene.blocks[block.parentId]?.childrenIds : scene.rootBlockIds;
    if (!siblings) {
        return { parentId: block.parentId };
    }
    const siblingsAfterMove = siblings.filter(id => id !== movingBlockId);
    const index = siblingsAfterMove.indexOf(afterBlockId);
    if (index === -1) {
        return { parentId: block.parentId };
    }
    return { parentId: block.parentId, beforeBlockId: siblingsAfterMove[index + 1] ?? null };
}

export function canAcceptChildren(block: StoryBlock | undefined): boolean {
    if (!block) {
        return false;
    }
    return block.kind === "control" || (block.kind === "nodeAction" && (block.payload.action === "choice" || block.payload.action === "choiceOption"));
}

export function isTextEditableBlock(block: StoryBlock): boolean {
    return Boolean(getTextSegment(block));
}

export function getBlockBadgeInfo(block: StoryBlock): { label: string; icon: typeof FileText } {
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") return { label: "Narration", icon: FileText };
        if (block.payload.action === "dialogue") return { label: "Dialogue", icon: MessageSquare };
        if (block.payload.action === "choice") return { label: "Choice", icon: GitBranch };
        return { label: "Choice option", icon: Route };
    }
    if (block.kind === "action") {
        if (block.payload.action === "setBackground") return { label: "Background", icon: Image };
        if (block.payload.action === "character") return { label: "Character", icon: UserRound };
        if (block.payload.action === "audio") return { label: "Audio", icon: Music };
        if (block.payload.action === "setVariable") return { label: "Variable", icon: Variable };
        return { label: "Wait", icon: Clock };
    }
    if (block.kind === "control") return { label: "Control", icon: Settings2 };
    if (block.kind === "jump") return { label: "Jump", icon: Route };
    if (block.kind === "code") return { label: "Code", icon: Code };
    return { label: "Note", icon: StickyNote };
}

export function describeBlock(block: StoryBlock, characters: Character[], scene?: StoryScene): string {
    void scene;
    if (block.kind === "nodeAction") {
        const payload = block.payload;
        if (payload.action === "narration") return payload.text.value || "Narration";
        if (payload.action === "dialogue") return `${getCharacterName(characters, payload.characterId)}: ${payload.text.value || "Dialogue"}`;
        if (payload.action === "choice") return `Choice ${payload.prompt?.value ? `- ${payload.prompt.value}` : ""}`;
        return `Option ${payload.text.value || ""}`;
    }
    if (block.kind === "action") {
        const payload = block.payload;
        if (payload.action === "setBackground") return `Set background ${payload.assetId || payload.color || "unassigned"}`;
        if (payload.action === "character") return `${payload.operation} character ${payload.characterId || "unassigned"}`;
        if (payload.action === "audio") return `${payload.operation} ${payload.assetId || "unassigned"}`;
        if (payload.action === "setVariable") return `${payload.target.key} = ${String(payload.value)}`;
        return payload.mode === "duration" ? `Wait ${payload.durationMs ?? 0}ms` : "Wait for click";
    }
    if (block.kind === "control") {
        return block.payload.control === "condition" ? "Condition" : `${block.payload.branch} branch`;
    }
    if (block.kind === "jump") {
        return `Jump ${block.payload.targetSceneId || "unassigned"}`;
    }
    if (block.kind === "code") {
        return `${block.payload.language} code`;
    }
    return block.payload.text.value || "Note";
}

export function getEmptyTextPlaceholder(block: StoryBlock): string {
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") return "Double-click to enter narration";
        if (block.payload.action === "choiceOption") return "Double-click to enter option text";
        if (block.payload.action === "choice") return "Double-click to enter choice prompt";
    }
    if (block.kind === "note") return "Double-click to enter a note";
    return "Double-click to enter text";
}

export function getCharacterName(characters: Character[], characterId: string | undefined): string {
    if (!characterId) {
        return "Unassigned character";
    }
    return characters.find(character => character.profile.getId() === characterId)?.profile.getName() ?? characterId;
}

export function selectRange(rows: VisibleStoryRow[], fromId: StoryBlockId, toId: StoryBlockId): Set<StoryBlockId> {
    const from = rows.findIndex(row => row.block.id === fromId);
    const to = rows.findIndex(row => row.block.id === toId);
    if (from === -1 || to === -1) {
        return new Set([toId]);
    }
    const [start, end] = from < to ? [from, to] : [to, from];
    return new Set(rows.slice(start, end + 1).map(row => row.block.id));
}

export function filterOutSelectedDescendants(scene: StoryScene, ids: StoryBlockId[]): StoryBlockId[] {
    const selected = new Set(ids);
    return ids.filter(id => {
        let parentId = scene.blocks[id]?.parentId ?? null;
        while (parentId) {
            if (selected.has(parentId)) {
                return false;
            }
            parentId = scene.blocks[parentId]?.parentId ?? null;
        }
        return Boolean(scene.blocks[id]);
    });
}

export function findPreviousSibling(scene: StoryScene, blockId: StoryBlockId): StoryBlock | null {
    const block = scene.blocks[blockId];
    if (!block) {
        return null;
    }
    const siblings = block.parentId ? scene.blocks[block.parentId]?.childrenIds : scene.rootBlockIds;
    if (!siblings) {
        return null;
    }
    const index = siblings.indexOf(blockId);
    return index > 0 ? scene.blocks[siblings[index - 1]] ?? null : null;
}
