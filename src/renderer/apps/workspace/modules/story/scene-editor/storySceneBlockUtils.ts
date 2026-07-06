import { Clock, Code, Eye, FileText, GitBranch, Image, Layers, MessageSquare, Move, Music, Puzzle, Route, Settings2, Sparkles, StickyNote, Type, UserRound, Variable, Video } from "lucide-react";
import type { StoryBlock, StoryBlockId, StoryRichRun, StoryScene, StoryTextSegment, StoryVariableRef } from "@shared/types/story";
import { resolveDisplayableTargetRef } from "@shared/types/story";
import { richIfMeaningful } from "./richText";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { StoryBlockTarget, VisibleStoryRow } from "./storySceneEditorTypes";
import { getActionCommandCategory, type ActionCommandCategoryId } from "./storyActionCommands";

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

function mergeSegment(text: StoryTextSegment, value: string, rich: StoryRichRun[] | undefined): StoryTextSegment {
    const meaningful = rich ? richIfMeaningful(rich) : undefined;
    const next: StoryTextSegment = { ...text, value };
    if (meaningful) {
        next.rich = meaningful;
    } else {
        delete next.rich;
    }
    return next;
}

export function updateTextPayload(block: StoryBlock, value: string, rich?: StoryRichRun[]): StoryBlock["payload"] | null {
    if (block.kind === "note") {
        return { ...block.payload, text: mergeSegment(block.payload.text, value, rich) };
    }
    if (block.kind !== "nodeAction") {
        return null;
    }
    if ("text" in block.payload) {
        return { ...block.payload, text: mergeSegment(block.payload.text, value, rich) };
    }
    if (block.payload.action === "choice" && block.payload.prompt) {
        return { ...block.payload, prompt: mergeSegment(block.payload.prompt, value, rich) };
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

export function getMoveTargetBefore(scene: StoryScene, movingBlockId: StoryBlockId, beforeBlockId: StoryBlockId | null): StoryBlockTarget {
    if (!beforeBlockId) {
        return { parentId: null };
    }
    const block = scene.blocks[beforeBlockId];
    if (!block) {
        return { parentId: null };
    }
    const siblings = block.parentId ? scene.blocks[block.parentId]?.childrenIds : scene.rootBlockIds;
    if (!siblings) {
        return { parentId: block.parentId };
    }
    const siblingsAfterMove = siblings.filter(id => id !== movingBlockId);
    return {
        parentId: block.parentId,
        beforeBlockId: siblingsAfterMove.includes(beforeBlockId) ? beforeBlockId : null,
    };
}

export function canAcceptChildren(block: StoryBlock | undefined): boolean {
    if (!block) {
        return false;
    }
    return block.kind === "control" ||
        (block.kind === "action" && block.payload.action === "nvl") ||
        (block.kind === "nodeAction" && (block.payload.action === "choice" || block.payload.action === "choiceOption"));
}

export function isTextEditableBlock(block: StoryBlock): boolean {
    return Boolean(getTextSegment(block));
}

export function getBlockBadgeInfo(block: StoryBlock): { label: string; icon: typeof FileText; iconColor: string } {
    const withCategory = (label: string, icon: typeof FileText, categoryId: ActionCommandCategoryId) => ({
        label,
        icon,
        iconColor: getActionCommandCategory(categoryId).iconColor,
    });
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") return withCategory("Narration", FileText, "character");
        if (block.payload.action === "dialogue") return withCategory("Dialogue", MessageSquare, "character");
        if (block.payload.action === "choice") return withCategory("Choice", GitBranch, "control");
        return withCategory("Choice option", Route, "control");
    }
    if (block.kind === "action") {
        if (block.payload.action === "setBackground") return withCategory("Background", Image, "scene");
        if (block.payload.action === "character") return withCategory("Character", UserRound, "character");
        if (block.payload.action === "audio") return withCategory("Audio", Music, "media");
        if (block.payload.action === "setVariable") return withCategory("Variable", Variable, "data");
        if (block.payload.action === "wait") return withCategory("Wait", Clock, "control");
        if (block.payload.action === "image") return withCategory("Image", Image, "image");
        if (block.payload.action === "displayable") {
            if (block.payload.operation === "transform") return withCategory("Transform", Move, "image");
            return withCategory("Displayable", Eye, "image");
        }
        if (block.payload.action === "text") return withCategory("Text", Type, "text");
        if (block.payload.action === "layer") return withCategory("Layer", Layers, "layer");
        if (block.payload.action === "video") return withCategory("Video", Video, "video");
        if (block.payload.action === "nvl") return withCategory("NVL", FileText, "scene");
        if (block.payload.action === "blueprint") return withCategory("Blueprint", Puzzle, "data");
        return withCategory("Effect", Sparkles, "effects");
    }
    if (block.kind === "control") return withCategory("Control", Settings2, "control");
    if (block.kind === "jump") return withCategory("Jump", Route, "scene");
    if (block.kind === "code") return withCategory("Code", Code, "utils");
    return withCategory("Note", StickyNote, "utils");
}

/** Short, user-safe label for a variable reference (never exposes internal ids). */
function variableRefShortLabel(ref: StoryVariableRef, scene?: StoryScene): string {
    if (ref.scope === "scene") {
        return scene?.sceneVariables?.[ref.variableId]?.name ?? "variable";
    }
    if (ref.scope === "saved") {
        return "saved variable";
    }
    return "persistent";
}

export function describeBlock(block: StoryBlock, characters: Character[], scene?: StoryScene): string {
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
        if (payload.action === "character") {
            const name = payload.characterId ? getCharacterName(characters, payload.characterId) : (payload.objectName || "character");
            return `${payload.operation} ${name}`;
        }
        if (payload.action === "audio") return `${payload.operation} ${payload.objectName || payload.assetId || "unassigned"}`;
        if (payload.action === "setVariable") return `${variableRefShortLabel(payload.target, scene)} = ${String(payload.value)}`;
        if (payload.action === "wait") return payload.mode === "duration" ? `Wait ${payload.durationMs ?? 0}ms` : "Wait for click";
        if (payload.action === "image") return `${payload.operation} image ${payload.objectName || "unnamed"}`;
        if (payload.action === "displayable") return `${payload.operation} ${resolveDisplayableTargetRef(scene, payload.target).name || "target"}`;
        if (payload.action === "text") return `${payload.operation} text ${payload.objectName || "unnamed"}`;
        if (payload.action === "layer") return `${payload.operation} layer ${payload.objectName || "unnamed"}`;
        if (payload.action === "video") return `${payload.operation} video ${payload.objectName || "unnamed"}`;
        if (payload.action === "nvl") return "NVL block";
        if (payload.action === "blueprint") return "Blueprint";
        return `${payload.effect} screen effect`;
    }
    if (block.kind === "control") {
        if (block.payload.control === "condition") return "Condition";
        if (block.payload.control === "conditionBranch") return `${block.payload.branch} branch`;
        return block.payload.control;
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
    return characters.find(character => character.profile.getId() === characterId)?.profile.getName() ?? "Unknown character";
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
