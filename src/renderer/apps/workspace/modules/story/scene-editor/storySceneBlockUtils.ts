import { Clock, Code, Eye, FileText, GitBranch, Image, Layers, MessageSquare, Move, Music, Puzzle, Route, Settings2, Sparkles, StickyNote, TriangleAlert, Type, UserRound, Variable, Video } from "lucide-react";
import type { StoryActionPayload, StoryBlock, StoryBlockId, StoryExpr, StoryRichRun, StoryScene, StorySceneId, StoryTextSegment, StoryVariableRef } from "@shared/types/story";
import { layerActionTargetRef, resolveDisplayableTargetRef, resolveStoryLayerRef, storyVariableRefKey } from "@shared/types/story";
import { storyMsToSeconds } from "@shared/utils/storyTime";
import { richIfMeaningful } from "./richText";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { CharacterAppearanceRef, StoryBlockTarget, VisibleStoryRow } from "./storySceneEditorTypes";
import { getActionCommandCategory, type ActionCommandCategoryId } from "./storyActionCommands";
import { translate } from "@/lib/i18n";

/**
 * The appearance each dialogue speaker has at its line, accumulated in a single document-order pass:
 * a character's most recent `enter`/`expression` sets it, an `exit` resets to default (absent =
 * the character's default form + default variants). A reading aid for the row avatars, not runtime
 * truth — it walks the tree linearly and does not model branch-specific stage state.
 */
export function buildDialogueAppearances(scene: StoryScene): Map<StoryBlockId, CharacterAppearanceRef> {
    const current = new Map<string, CharacterAppearanceRef>();
    const result = new Map<StoryBlockId, CharacterAppearanceRef>();
    const visit = (blockId: StoryBlockId) => {
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        if (block.kind === "action" && block.payload.action === "character" && block.payload.characterId) {
            const characterId = block.payload.characterId;
            if (block.payload.operation === "exit") {
                current.delete(characterId);
            } else if (block.payload.operation === "enter" || block.payload.operation === "expression") {
                current.set(characterId, { formName: block.payload.formName, variants: block.payload.variants });
            }
        } else if (block.kind === "nodeAction" && block.payload.action === "dialogue" && block.payload.characterId) {
            const appearance = current.get(block.payload.characterId);
            if (appearance) {
                result.set(block.id, appearance);
            }
        }
        block.childrenIds.forEach(visit);
    };
    scene.rootBlockIds.forEach(visit);
    return result;
}

type GroupSpeaker = { characterId?: string; speakerName?: string };

/** Whether two dialogue speakers are the same run: character id wins; a bare, non-empty name ties otherwise. */
function sameGroupSpeaker(a: GroupSpeaker, b: GroupSpeaker): boolean {
    if (a.characterId || b.characterId) {
        return Boolean(a.characterId) && a.characterId === b.characterId;
    }
    return Boolean(a.speakerName) && a.speakerName === b.speakerName;
}

/**
 * Annotate rows with their dialogue-group role (WI-5), a pure render projection over the visible
 * sequence. A run is consecutive dialogue rows with the same speaker; a same-character `expression`
 * row rides along without breaking it (it renders as an in-group differential note). Any other kind
 * ends the run. Only dialogue and in-group expression rows are cloned; every other row is returned
 * untouched, so referential identity is preserved where it can be.
 */
export function annotateDialogueGroups(rows: VisibleStoryRow[]): VisibleStoryRow[] {
    let groupSpeaker: GroupSpeaker | null = null;
    return rows.map(row => {
        const block = row.block;
        if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
            const speaker: GroupSpeaker = { characterId: block.payload.characterId, speakerName: block.payload.speakerName };
            if (groupSpeaker && sameGroupSpeaker(groupSpeaker, speaker)) {
                return { ...row, groupRole: "member" as const };
            }
            groupSpeaker = speaker;
            return { ...row, groupRole: "head" as const };
        }
        if (
            block.kind === "action"
            && block.payload.action === "character"
            && block.payload.operation === "expression"
            && groupSpeaker?.characterId
            && block.payload.characterId === groupSpeaker.characterId
        ) {
            // An expression change for the group's speaker: an in-group note; the run continues.
            return { ...row, groupRole: "member" as const };
        }
        groupSpeaker = null;
        return row;
    });
}

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
 * Whether opening this block's property inspector shows anything worth a card.
 *
 * A condition container has nothing of its own to edit - its branches carry the logic, and its
 * add-branch affordances live in the footer - and a condition branch (if / else-if / else) authors
 * its condition inline through the header chip, not a card. Both would otherwise open a near-empty
 * placeholder card, which reads as broken. They are "card-less": {@link isTextEditableBlock} still
 * wins for text rows, so this is only consulted for the non-text action/control rows.
 */
export function hasInspector(block: StoryBlock): boolean {
    if (block.kind === "control" && (block.payload.control === "condition" || block.payload.control === "conditionBranch")) {
        return false;
    }
    return true;
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

/** Header descriptor for a container block - the pill text + which inline editors it exposes. */
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
    if (block.kind === "declaration") {
        return withCategory(translate(`story.badge.declare.${block.payload.scope}` as Parameters<typeof translate>[0]), Variable, "data");
    }
    return withCategory(translate("story.badge.note"), StickyNote, "utils");
}

/**
 * Short, user-safe label for a variable reference (never exposes internal ids).
 *
 * v6: the variableId IS a declaration block's id, so the name comes straight off the row - the
 * current scene first, then the rest of the document. This is what made "saved variable += 5" read
 * as `gold += 5`: a row that does not say WHICH variable it touches is a row the author has to open
 * to understand, which fails the first principle.
 */
function variableRefShortLabel(ref: StoryVariableRef, scene?: StoryScene, scenes?: Record<string, StoryScene>): string {
    if (ref.scope === "persistent") {
        for (const candidate of Object.values(scenes ?? {})) {
            for (const block of Object.values(candidate.blocks)) {
                if (block.kind === "declaration" && block.payload.storageKey === ref.storageKey) {
                    return block.payload.name;
                }
            }
        }
        // Blueprint-declared: its name lives in the blueprint document, out of reach here.
        return translate("story.describe.persistent");
    }
    const inScene = scene?.blocks[ref.variableId];
    if (inScene?.kind === "declaration") {
        return inScene.payload.name;
    }
    for (const candidate of Object.values(scenes ?? {})) {
        const block = candidate.blocks[ref.variableId];
        if (block?.kind === "declaration") {
            return block.payload.name;
        }
    }
    return translate("story.describe.variableFallback");
}

/**
 * How an assignment row reads in the list.
 *
 * `gold = 100` for a constant, and the *shorthand* for the shapes that have one — `/inc gold` rather
 * than `gold = gold + (1)`. The author typed a shorthand; echoing back the desugared form would make
 * the row grow every time they glanced at it and teach them the shorthand does not survive.
 *
 * Recognized structurally rather than from a stored "this was an /inc" flag, so a `/set gold gold + 1`
 * typed longhand reads as an increment too — it *is* one.
 *
 * This mirrors `describeAssignment` in `storySceneProjection`, which formats the same block for the
 * text projection. Two renderers for one payload is pre-existing here (every action has both); the
 * expression case was added to the projection first and this one was missed, which is why an
 * `/inc gold` row displayed as `gold = true` — the seed value — while the stored payload was correct.
 */
function describeAssignment(payload: Extract<StoryActionPayload, { action: "setVariable" }>, name: string): string {
    const ast = payload.expression?.ast;
    if (!ast) {
        return `${name} = ${String(payload.value)}`;
    }
    const targetKey = storyVariableRefKey(payload.target);
    const readsTarget = (node: StoryExpr) => node.kind === "var" && storyVariableRefKey(node.target) === targetKey;

    if (ast.kind === "unary" && ast.op === "!" && readsTarget(ast.operand)) {
        return `${name} = !${name}`;
    }
    if (ast.kind === "binary" && (ast.op === "+" || ast.op === "-") && readsTarget(ast.left)) {
        const step = ast.right.kind === "literal" ? String(ast.right.value) : "…";
        return `${name} ${ast.op}= ${step}`;
    }
    return `${name} = ${payload.expression?.source ?? ""}`;
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
            // Localized verb + the target name ("Enter · Alice"), not the raw English enum ("enter Alice").
            const operation = translate(`story.describe.charOp.${payload.operation}` as Parameters<typeof translate>[0]);
            return `${operation} ${name}`;
        }
        if (payload.action === "audio") return `${payload.operation} ${payload.objectName || payload.assetId || translate("story.describe.unassigned")}`;
        if (payload.action === "setVariable") return describeAssignment(payload, variableRefShortLabel(payload.target, scene, scenes));
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
        // The author's own text is the most useful thing to show them - it never parsed, so there is
        // nothing to describe in its place.
        return block.payload.source || translate("story.describe.invalid");
    }
    if (block.kind === "declaration") {
        // The row reads as what it declares: `gold: number = 100`. The scope arrives via the badge.
        const declared = block.payload.defaultValue !== undefined
            ? `${block.payload.name}: ${block.payload.valueType} = ${JSON.stringify(block.payload.defaultValue)}`
            : `${block.payload.name}: ${block.payload.valueType}`;
        return declared;
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

/** The editor accent colour a character carries, or `undefined` when none is set (keep the default ink). */
export function getCharacterColor(characters: Character[], characterId: string | undefined): string | undefined {
    if (!characterId) {
        return undefined;
    }
    return characters.find(character => character.profile.getId() === characterId)?.profile.getColor();
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

/**
 * The row to land on after deleting `roots` (and their descendants): the nearest survivor *above* the
 * topmost deleted row - its previous line, the editor convention - or the first survivor below when the
 * deletion starts at the very top of the list. `null` when nothing survives (the whole scene went).
 *
 * A row counts as deleted when it or any ancestor is a root, so a collapsed container's hidden children
 * never need enumerating. Pure, so the post-delete focus is unit-tested rather than only observed in the
 * running app.
 */
export function nextSelectionAfterDelete(scene: StoryScene, visibleRows: VisibleStoryRow[], roots: StoryBlockId[]): StoryBlockId | null {
    const rootSet = new Set(roots);
    const isDeleted = (blockId: StoryBlockId): boolean => {
        let id: StoryBlockId | null = blockId;
        while (id) {
            if (rootSet.has(id)) {
                return true;
            }
            id = scene.blocks[id]?.parentId ?? null;
        }
        return false;
    };
    const firstDeletedIndex = visibleRows.findIndex(row => isDeleted(row.block.id));
    if (firstDeletedIndex === -1) {
        return null;
    }
    // Every row above the first deleted one survives (it is the *first* deleted), so its previous line
    // is a safe landing. Only when the top row itself is going do we fall to the first survivor below.
    if (firstDeletedIndex > 0) {
        return visibleRows[firstDeletedIndex - 1].block.id;
    }
    return visibleRows.find((row, index) => index > firstDeletedIndex && !isDeleted(row.block.id))?.block.id ?? null;
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
