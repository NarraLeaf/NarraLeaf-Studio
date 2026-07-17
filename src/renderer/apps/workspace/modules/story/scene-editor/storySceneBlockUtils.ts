import { Clock, Code, Eye, FileText, GitBranch, Image, Layers, MessageSquare, Move, Music, Puzzle, Route, Settings2, Sparkles, StickyNote, TriangleAlert, Type, UserRound, Variable, Video } from "lucide-react";
import type { StoryBlock, StoryBlockId, StoryRichRun, StoryScene, StorySceneId, StoryTextSegment, StoryVariableRef } from "@shared/types/story";
import { layerActionTargetRef, resolveDisplayableTargetRef, resolveStoryLayerRef } from "@shared/types/story";
import { storyMsToSeconds } from "@shared/utils/storyTime";
import { richIfMeaningful } from "./richText";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { StoryBlockTarget, VisibleStoryRow } from "./storySceneEditorTypes";
import { getActionCommandCategory, type ActionCommandCategoryId } from "./storyActionCommands";
import { translate } from "@/lib/i18n";

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

/**
 * A block that owns nested children and should render as an accordion container (a titled header +
 * an indented, collapsible body) rather than a plain action row. Equivalent to `canAcceptChildren`;
 * kept as a distinct name so rendering intent reads clearly at call sites.
 */
export function isContainerBlock(block: StoryBlock | undefined): boolean {
    return canAcceptChildren(block);
}

export type StoryContainerRole = "condition" | "branch" | "group" | "menu" | "option" | "nvl";

export type StoryContainerHeaderInfo = {
    /** Plain-language pill label shown on the accordion header (proper case, no ALL-CAPS). */
    pill: string;
    role: StoryContainerRole;
    /** Branch (if / else-if) headers carry an editable condition; else / others do not. */
    hasCondition: boolean;
    /** Repeat groups expose an inline repeat count. */
    repeatTimes?: number;
};

/** Header descriptor for a container block — the pill text + which inline editors it exposes. */
export function getContainerHeaderInfo(block: StoryBlock): StoryContainerHeaderInfo | null {
    if (block.kind === "control") {
        const payload = block.payload;
        if (payload.control === "condition") {
            return { pill: translate("story.containerHeader.condition"), role: "condition", hasCondition: false };
        }
        if (payload.control === "conditionBranch") {
            const pill = payload.branch === "if"
                ? translate("story.containerHeader.if")
                : payload.branch === "elseIf"
                    ? translate("story.containerHeader.elseIf")
                    : translate("story.containerHeader.else");
            return { pill, role: "branch", hasCondition: payload.branch !== "else" };
        }
        if (payload.control === "repeat") {
            return { pill: translate("story.containerHeader.repeat"), role: "group", hasCondition: false, repeatTimes: payload.times ?? 1 };
        }
        if (payload.control === "parallel") {
            return { pill: translate("story.containerHeader.parallel"), role: "group", hasCondition: false };
        }
        if (payload.control === "race") {
            return { pill: translate("story.containerHeader.race"), role: "group", hasCondition: false };
        }
        return { pill: translate("story.containerHeader.sequence"), role: "group", hasCondition: false };
    }
    if (block.kind === "action" && block.payload.action === "nvl") {
        return { pill: translate("story.containerHeader.nvl"), role: "nvl", hasCondition: false };
    }
    if (block.kind === "nodeAction" && block.payload.action === "choice") {
        return { pill: translate("story.containerHeader.menu"), role: "menu", hasCondition: false };
    }
    if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
        return { pill: translate("story.containerHeader.option"), role: "option", hasCondition: false };
    }
    return null;
}

export function getBlockBadgeInfo(block: StoryBlock): { label: string; icon: typeof FileText; iconColor: string } {
    const withCategory = (label: string, icon: typeof FileText, categoryId: ActionCommandCategoryId) => ({
        label,
        icon,
        iconColor: getActionCommandCategory(categoryId).iconColor,
    });
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") return withCategory(translate("story.badge.narration"), FileText, "character");
        if (block.payload.action === "dialogue") return withCategory(translate("story.badge.dialogue"), MessageSquare, "character");
        if (block.payload.action === "choice") return withCategory(translate("story.badge.choice"), GitBranch, "control");
        return withCategory(translate("story.badge.choiceOption"), Route, "control");
    }
    if (block.kind === "action") {
        if (block.payload.action === "setBackground") return withCategory(translate("story.badge.background"), Image, "scene");
        if (block.payload.action === "character") return withCategory(translate("story.badge.character"), UserRound, "character");
        if (block.payload.action === "audio") return withCategory(translate("story.badge.audio"), Music, "media");
        if (block.payload.action === "setVariable") return withCategory(translate("story.badge.variable"), Variable, "data");
        if (block.payload.action === "wait") return withCategory(translate("story.badge.wait"), Clock, "control");
        if (block.payload.action === "image") return withCategory(translate("story.badge.image"), Image, "image");
        if (block.payload.action === "displayable") {
            if (block.payload.operation === "transform") return withCategory(translate("story.badge.transform"), Move, "image");
            return withCategory(translate("story.badge.displayable"), Eye, "image");
        }
        if (block.payload.action === "text") return withCategory(translate("story.badge.text"), Type, "text");
        if (block.payload.action === "layer") return withCategory(translate("story.badge.layer"), Layers, "layer");
        if (block.payload.action === "video") return withCategory(translate("story.badge.video"), Video, "video");
        if (block.payload.action === "nvl") return withCategory(translate("story.badge.nvl"), FileText, "scene");
        if (block.payload.action === "blueprint") return withCategory(translate("story.badge.blueprint"), Puzzle, "data");
        return withCategory(translate("story.badge.effect"), Sparkles, "effects");
    }
    if (block.kind === "control") return withCategory(translate("story.badge.control"), Settings2, "control");
    if (block.kind === "jump") return withCategory(translate("story.badge.jump"), Route, "scene");
    if (block.kind === "code") return withCategory(translate("story.badge.code"), Code, "utils");
    if (block.kind === "invalid") {
        // Deliberately not a category colour: this row is an error, not another kind of action, and a
        // build will refuse it. It has to read as wrong at a glance.
        return { label: translate("story.badge.invalid"), icon: TriangleAlert, iconColor: "rgb(var(--nl-danger))" };
    }
    return withCategory(translate("story.badge.note"), StickyNote, "utils");
}

/** Short, user-safe label for a variable reference (never exposes internal ids). */
function variableRefShortLabel(ref: StoryVariableRef, scene?: StoryScene): string {
    if (ref.scope === "scene") {
        return scene?.sceneVariables?.[ref.variableId]?.name ?? translate("story.describe.variableFallback");
    }
    if (ref.scope === "saved") {
        return translate("story.describe.savedVariable");
    }
    return translate("story.describe.persistent");
}

export function describeBlock(block: StoryBlock, characters: Character[], scene?: StoryScene, scenes?: Record<StorySceneId, StoryScene>): string {
    if (block.kind === "nodeAction") {
        const payload = block.payload;
        if (payload.action === "narration") return payload.text.value || translate("story.describe.narration");
        if (payload.action === "dialogue") return `${getCharacterName(characters, payload.characterId)}: ${payload.text.value || translate("story.describe.dialogue")}`;
        if (payload.action === "choice") return `${translate("story.describe.choice")}${payload.prompt?.value ? ` - ${payload.prompt.value}` : ""}`;
        return `${translate("story.describe.option")} ${payload.text.value || ""}`;
    }
    if (block.kind === "action") {
        const payload = block.payload;
        if (payload.action === "setBackground") return translate("story.describe.setBackground", { value: payload.assetId || payload.color || translate("story.describe.unassigned") });
        if (payload.action === "character") {
            const name = payload.characterId ? getCharacterName(characters, payload.characterId) : (payload.objectName || translate("story.describe.characterFallback"));
            return `${payload.operation} ${name}`;
        }
        if (payload.action === "audio") return `${payload.operation} ${payload.objectName || payload.assetId || translate("story.describe.unassigned")}`;
        if (payload.action === "setVariable") return `${variableRefShortLabel(payload.target, scene)} = ${String(payload.value)}`;
        if (payload.action === "wait") return payload.mode === "duration" ? translate("story.describe.waitDuration", { seconds: storyMsToSeconds(payload.durationMs ?? 0) }) : translate("story.describe.waitClick");
        if (payload.action === "image") return translate("story.describe.image", { operation: payload.operation, name: payload.objectName || translate("story.describe.unnamed") });
        if (payload.action === "displayable") return `${payload.operation} ${resolveDisplayableTargetRef(scene, payload.target).label || translate("story.describe.targetFallback")}`;
        if (payload.action === "text") return translate("story.describe.text", { operation: payload.operation, name: payload.objectName || translate("story.describe.unnamed") });
        if (payload.action === "layer") {
            const layerName = payload.operation === "create"
                ? (payload.objectName || translate("story.describe.unnamed"))
                : (resolveStoryLayerRef(scene, layerActionTargetRef(payload.target, payload.objectName)).name || translate("story.describe.unnamed"));
            return translate("story.describe.layer", { operation: payload.operation, name: layerName });
        }
        if (payload.action === "video") return translate("story.describe.video", { operation: payload.operation, name: payload.objectName || translate("story.describe.unnamed") });
        if (payload.action === "nvl") return translate("story.describe.nvl");
        if (payload.action === "blueprint") return translate("story.describe.blueprint");
        return translate("story.describe.effect", { effect: payload.effect });
    }
    if (block.kind === "control") {
        if (block.payload.control === "condition") return translate("story.describe.condition");
        if (block.payload.control === "conditionBranch") return translate("story.describe.branch", { branch: block.payload.branch });
        return block.payload.control;
    }
    if (block.kind === "jump") {
        return translate("story.describe.jump", { scene: getSceneName(scenes, block.payload.targetSceneId) });
    }
    if (block.kind === "code") {
        return translate("story.describe.code", { language: block.payload.language });
    }
    if (block.kind === "invalid") {
        // The author's own text is the most useful thing to show them — it never parsed, so there is
        // nothing to describe in its place.
        return block.payload.source || translate("story.describe.invalid");
    }
    return block.payload.text.value || translate("story.describe.note");
}

export function getEmptyTextPlaceholder(block: StoryBlock): string {
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") return translate("story.emptyPlaceholder.narration");
        if (block.payload.action === "choiceOption") return translate("story.emptyPlaceholder.option");
        if (block.payload.action === "choice") return translate("story.emptyPlaceholder.choice");
    }
    if (block.kind === "note") return translate("story.emptyPlaceholder.note");
    return translate("story.emptyPlaceholder.text");
}

export function getSceneName(scenes: Record<StorySceneId, StoryScene> | undefined, sceneId: string | undefined): string {
    if (!sceneId) {
        return translate("story.describe.sceneUnassigned");
    }
    return scenes?.[sceneId]?.name || translate("story.describe.sceneUnknown");
}

export function getCharacterName(characters: Character[], characterId: string | undefined): string {
    if (!characterId) {
        return translate("story.characterName.unassigned");
    }
    return characters.find(character => character.profile.getId() === characterId)?.profile.getName() ?? translate("story.characterName.unknown");
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
