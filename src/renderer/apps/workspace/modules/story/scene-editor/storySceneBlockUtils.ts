import { Aperture, Bookmark, Clock, Code, CornerUpLeft, Eye, FileText, GitBranch, Image, Layers, MessageSquare, Move, Music, Puzzle, Route, Settings2, Sparkles, StickyNote, TriangleAlert, Type, UserRound, Variable, Video, Wind } from "lucide-react";
import type { StoryActionPayload, StoryBlock, StoryBlockId, StoryExpr, StoryRichRun, StoryScene, StorySceneId, StoryTextSegment, StoryVariableRef } from "@shared/types/story";
import { describeDeclaration, layerActionTargetRef, resolveDisplayableTargetRef, resolveStoryLayerRef, storyVariableRefKey } from "@shared/types/story";
import { storyMsToSeconds } from "@shared/utils/storyTime";
import { richIfMeaningful } from "./richText";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { CharacterAppearanceRef, StoryBlockTarget, StoryStagePlacement, VisibleStoryRow } from "./storySceneEditorTypes";
import { getCommandGroup, type StoryCommandGroupId } from "./storyCommandCategories";
import { getPresetPosition } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { translate } from "@/lib/i18n";

/**
 * The appearance each dialogue speaker has at its line, accumulated in a single document-order pass:
 * a character's most recent `enter`/`expression` sets it, an `exit` resets to default (absent =
 * the character's default form + default variants). A reading aid for the row avatars, not runtime
 * truth — it walks the tree linearly and does not model branch-specific stage state.
 */
/** The `at=` placement a character block carries, or undefined when its transform is not a placement. */
function placementOf(preset: string | undefined): StoryStagePlacement | undefined {
    return preset === "left" || preset === "center" || preset === "right" ? preset : undefined;
}

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
            const position = placementOf(block.payload.transform?.preset);
            if (block.payload.operation === "exit") {
                current.delete(characterId);
            } else if (block.payload.operation === "enter") {
                // An entrance shows the character and sets the whole appearance, placement included — its
                // own block is the row the group-header dropdown rewrites (WI-3, M3.1).
                current.set(characterId, { formName: block.payload.formName, variants: block.payload.variants, position, positionSourceId: block.id, shown: true });
            } else if (block.payload.operation === "expression") {
                // An expression changes the form/variant but not where the character stands, so the
                // accumulated placement (and the row that owns it) is preserved.
                const previous = current.get(characterId);
                current.set(characterId, { ...previous, formName: block.payload.formName, variants: block.payload.variants, shown: true });
            } else if (block.payload.operation === "move" && position) {
                // A placement move relocates the character and becomes the row the dropdown rewrites —
                // including the case where the group-header dropdown authored this `/move` for a speaker
                // with no prior enter (so the round-trip reads its own write back). It does not "show" the
                // character (a move on a hidden one is a runtime no-op), so it never invents an avatar; a
                // coordinate/scale-only move carries no placement and leaves the accumulated one untouched.
                current.set(characterId, { ...current.get(characterId), position, positionSourceId: block.id });
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

/**
 * Whether a row survives the "narrative only" filter (WI-6): narration, dialogue, choice prompts and
 * options, and studio notes. Everything else — action (including expression), control, jump,
 * declaration, code, invalid — is staging and hides. A whitelist, so a new staging kind hides by default.
 */
export function isNarrativeRow(block: StoryBlock): boolean {
    if (block.kind === "note") {
        return true;
    }
    if (block.kind === "nodeAction") {
        const action = block.payload.action;
        return action === "narration" || action === "dialogue" || action === "choice" || action === "choiceOption";
    }
    return false;
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
 * sequence. A run is consecutive dialogue rows with the same speaker *under the same container*; a
 * same-character `expression` row rides along without breaking it (it renders as an in-group
 * differential note). Any other kind — or a change of `parentId` — ends the run, so an option body's
 * last line never groups with a same-speaker line that lives outside the container (adjacency in the
 * flattened list is not adjacency in the tree). Only dialogue and in-group expression rows are cloned;
 * every other row is returned untouched, so referential identity is preserved where it can be.
 *
 * `groupContinues` is set on a head whose very next row is one of its members. It is not a grouping
 * rule — the runs are exactly the ones the loop below already found — only the one fact a row cannot
 * see about itself: whether the attribution rail has to leave its bottom edge (U1 WI-1). Without it
 * the rail starts abruptly under the first continuation line and never reaches the speaker it points
 * at, which is the whole thing it exists to say.
 */
export function annotateDialogueGroups(rows: VisibleStoryRow[]): VisibleStoryRow[] {
    let groupSpeaker: GroupSpeaker | null = null;
    let groupParentId: StoryBlockId | null = null;
    const annotated = rows.map(row => {
        const block = row.block;
        const parentId = block.parentId ?? null;
        const sameContainer = groupSpeaker !== null && groupParentId === parentId;
        if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
            const speaker: GroupSpeaker = { characterId: block.payload.characterId, speakerName: block.payload.speakerName };
            if (sameContainer && sameGroupSpeaker(groupSpeaker!, speaker)) {
                return { ...row, groupRole: "member" as const };
            }
            groupSpeaker = speaker;
            groupParentId = parentId;
            return { ...row, groupRole: "head" as const };
        }
        if (
            block.kind === "action"
            && block.payload.action === "character"
            && block.payload.operation === "expression"
            && sameContainer
            && groupSpeaker!.characterId
            && block.payload.characterId === groupSpeaker!.characterId
        ) {
            // An expression change for the group's speaker: an in-group note; the run continues.
            return { ...row, groupRole: "member" as const };
        }
        groupSpeaker = null;
        groupParentId = null;
        return row;
    });
    return annotated.map((row, index) =>
        row.groupRole === "head" && annotated[index + 1]?.groupRole === "member"
            ? { ...row, groupContinues: true }
            : row);
}

export function buildVisibleRows(scene: StoryScene, collapsedIds: Set<StoryBlockId>): VisibleStoryRow[] {
    const rows: VisibleStoryRow[] = [];
    const visit = (blockId: StoryBlockId, depth: number, disabledAncestor: boolean) => {
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        // Disabled propagates down: a disabled container's whole subtree renders muted (and compiles
        // out), so a row is effectively disabled when it or any ancestor is (WI-3 / schema v7).
        const disabled = disabledAncestor || Boolean(block.disabled);
        rows.push(disabled ? { block, depth, lineNumber: rows.length + 1, disabled } : { block, depth, lineNumber: rows.length + 1 });
        if (!collapsedIds.has(blockId)) {
            block.childrenIds.forEach(childId => visit(childId, depth + 1, disabled));
        }
    };
    scene.rootBlockIds.forEach(blockId => visit(blockId, 0, false));
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
    // `label` and `goto` are the two control rows that are NOT containers: a label is a point and a
    // goto is a move, neither has a body. Everything else under `control` groups rows.
    if (block.kind === "control" && (block.payload.control === "label" || block.payload.control === "goto")) {
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
        // Not containers, so they have no header at all - they render as ordinary rows.
        if (payload.control === "label" || payload.control === "goto") {
            return null;
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

/**
 * The row's badge and its left-edge colour bar. `iconColor` comes from the command GROUP (see
 * `storyCommandCategories.ts`), which is why the 13→8 rearrangement changed almost nothing here: the
 * four stage subjects stayed separate colour units precisely so this surface would not lose the
 * distinctions it earns. The two rows that did change category changed on purpose - a screen effect
 * belongs to the scene, a blueprint call is a tool.
 */
export function getBlockBadgeInfo(block: StoryBlock): { label: string; icon: typeof FileText; iconColor: string } {
    const withCategory = (label: string, icon: typeof FileText, groupId: StoryCommandGroupId) => ({
        label,
        icon,
        iconColor: getCommandGroup(groupId).iconColor,
    });
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") return withCategory(translate("story.badge.narration"), FileText, "character");
        if (block.payload.action === "dialogue") return withCategory(translate("story.badge.dialogue"), MessageSquare, "character");
        if (block.payload.action === "choice") return withCategory(translate("story.badge.choice"), GitBranch, "flow");
        return withCategory(translate("story.badge.choiceOption"), Route, "flow");
    }
    if (block.kind === "action") {
        if (block.payload.action === "setBackground") return withCategory(translate("story.badge.background"), Image, "scene");
        if (block.payload.action === "character") return withCategory(translate("story.badge.character"), UserRound, "character");
        if (block.payload.action === "audio") return withCategory(translate("story.badge.audio"), Music, "sound");
        if (block.payload.action === "setVariable") return withCategory(translate("story.badge.variable"), Variable, "data");
        if (block.payload.action === "wait") return withCategory(translate("story.badge.wait"), Clock, "flow");
        if (block.payload.action === "image") return withCategory(translate("story.badge.image"), Image, "image");
        if (block.payload.action === "displayable") {
            if (block.payload.operation === "transform") return withCategory(translate("story.badge.transform"), Move, "image");
            return withCategory(translate("story.badge.displayable"), Eye, "image");
        }
        if (block.payload.action === "text") return withCategory(translate("story.badge.text"), Type, "text");
        if (block.payload.action === "layer") return withCategory(translate("story.badge.layer"), Layers, "layer");
        if (block.payload.action === "video") return withCategory(translate("story.badge.video"), Video, "video");
        // Its own badge and hue, not the screen-effect one: a vfx is a stage object with a name and a
        // lifetime, while `/blink` is a one-shot the scene plays.
        if (block.payload.action === "vfx") return withCategory(translate("story.badge.vfx"), Wind, "vfx");
        if (block.payload.action === "nvl") return withCategory(translate("story.badge.nvl"), FileText, "scene");
        if (block.payload.action === "blueprint") return withCategory(translate("story.badge.blueprint"), Puzzle, "utils");
        // Its own badge, not "Effect": `/camera darken` dims the whole stage and outlives the scene,
        // while `/vignette` is a mask layer inside it. The row has to say which one it is at a glance.
        if (block.payload.action === "camera") return withCategory(translate("story.badge.camera"), Aperture, "camera");
        // A screen effect is a property of the scene it happens in (§4.1), so it wears the scene hue;
        // the Sparkles badge is what still tells a `/blink` row apart from a `/bg` row at a glance.
        return withCategory(translate("story.badge.effect"), Sparkles, "scene");
    }
    if (block.kind === "control") {
        // A label and a goto get their own badges: they read as a destination and a move, and both
        // would otherwise wear the generic "Control" of a container they are not.
        if (block.payload.control === "label") return withCategory(translate("story.badge.label"), Bookmark, "flow");
        if (block.payload.control === "goto") return withCategory(translate("story.badge.goto"), CornerUpLeft, "flow");
        return withCategory(translate("story.badge.control"), Settings2, "flow");
    }
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
                if (block.kind === "declaration" && block.payload.storageKey === ref.variableId) {
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

/**
 * `xalign → the `at=` word that lands there`, derived from {@link getPresetPosition} — the one forward
 * table for `left/center/right → xalign` — rather than restating its numbers, which would let the two
 * drift and leave this summary quietly naming the wrong side. An xalign no word produces is absent
 * from the table, and the row reads as its raw aligns instead.
 */
const CAMERA_PAN_PLACEMENTS: Record<number, StoryStagePlacement> = (["left", "center", "right"] as const)
    .reduce<Record<number, StoryStagePlacement>>((table, placement) => {
        const xalign = getPresetPosition(placement, {})?.xalign;
        if (xalign !== undefined) {
            table[xalign] = placement;
        }
        return table;
    }, {});

/**
 * How a camera row reads: the operation plus the one value it carries. The verb is NOT repeated from
 * the badge, but the knob is named ("Zoom ×1.5", not "×1.5"), because five operations share one badge.
 */
function describeCamera(payload: Extract<StoryActionPayload, { action: "camera" }>): string {
    const operation = translate(`story.describe.cameraOp.${payload.operation}` as Parameters<typeof translate>[0]);
    if (payload.operation === "zoom") {
        return `${operation} ×${payload.zoom ?? 1}`;
    }
    if (payload.operation === "rotate") {
        return `${operation} ${payload.rotation ?? 0}°`;
    }
    if (payload.operation === "darken") {
        return `${operation} ${Math.round(Math.min(1, Math.max(0, payload.darkness ?? 0)) * 100)}%`;
    }
    if (payload.operation === "pan") {
        const xalign = payload.position?.xalign ?? 0.5;
        const yalign = payload.position?.yalign ?? 0.5;
        const placement = yalign === 0.5 && !payload.position?.xoffset && !payload.position?.yoffset
            ? CAMERA_PAN_PLACEMENTS[xalign]
            : undefined;
        return `${operation} ${placement ? translate(`story.position.${placement}`) : `${Math.round(xalign * 100)}% · ${Math.round(yalign * 100)}%`}`;
    }
    return operation;
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
            // A rename's whole content is the new label, so the row shows it - "Rename Stranger" would
            // say nothing about what the player is about to read.
            if (payload.operation === "setName") {
                return `${operation} ${name} → ${payload.displayName || translate("story.describe.unnamed")}`;
            }
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
        if (payload.action === "vfx") return translate("story.describe.vfx", { operation: payload.operation, name: payload.objectName || translate("story.describe.unnamed") });
        if (payload.action === "nvl") return translate("story.describe.nvl");
        if (payload.action === "blueprint") return translate("story.describe.blueprint");
        if (payload.action === "camera") return describeCamera(payload);
        if (payload.action === "plugin") return payload.actionId;
        return translate("story.describe.effect", { effect: payload.effect });
    }
    if (block.kind === "control") {
        if (block.payload.control === "condition") return translate("story.describe.condition");
        if (block.payload.control === "conditionBranch") return translate("story.describe.branch", { branch: block.payload.branch });
        // The name IS the row: a label row saying only "Label" would leave the author counting rows
        // to find which one a goto points at.
        if (block.payload.control === "label") return translate("story.describe.label", { name: block.payload.name || translate("story.describe.unnamed") });
        if (block.payload.control === "goto") return translate("story.describe.goto", { name: block.payload.targetLabel || translate("story.describe.unnamed") });
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
        return describeDeclaration(block);
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

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
    const value = hex.trim().replace(/^#/, "");
    const full = value.length === 3 ? value.split("").map(channel => channel + channel).join("") : value;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) {
        return null;
    }
    return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
    };
}

/** WCAG relative luminance (0–1) of a hex colour, or `null` when it cannot be parsed. */
function relativeLuminance(hex: string): number | null {
    const rgb = parseHexColor(hex);
    if (!rgb) {
        return null;
    }
    const linear = (value: number) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

/**
 * Whether a nametag accent stays legible on *both* themes. The editor renders light and dark, so an
 * accent that all but matches one theme's surface — near-white (washes out on light) or near-black
 * (drowns on dark) — is unreadable there. The luminance band keeps ordinary saturated accents and
 * drops only those near-background extremes, which then fall back to the default ink. The bounds are a
 * chosen guard, not a WCAG-AA promise: an accent is decorative, it only has to be visible.
 */
export function isReadableAccentColor(hex: string): boolean {
    const luminance = relativeLuminance(hex);
    return luminance !== null && luminance > 0.03 && luminance < 0.85;
}

/**
 * The editor accent colour a character carries, or `undefined` when none is set — or when the one set
 * would be unreadable on either theme's surface, in which case the nametag keeps the default ink
 * rather than disappearing into the background (see {@link isReadableAccentColor}).
 */
export function getCharacterColor(characters: Character[], characterId: string | undefined): string | undefined {
    if (!characterId) {
        return undefined;
    }
    const color = characters.find(character => character.profile.getId() === characterId)?.profile.getColor();
    return color && isReadableAccentColor(color) ? color : undefined;
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

/**
 * `Backspace` on selected rows that are not being edited: which row, if any, becomes a blank line in
 * place instead of being deleted. Returns where the replacement goes and which row it replaces, or
 * null when the plain delete should run.
 *
 * The rule is deliberately narrow - it only holds where a text editor's Backspace would obviously do
 * the same thing:
 * - **one row only.** A multi-row Backspace stays a bulk delete; turning a selection into a column of
 *   blank lines is nobody's muscle memory.
 * - **a non-text row.** Text rows already own the rest of the ladder (empty line → previous row).
 * - **no children.** Replacing a container that holds a subtree would silently destroy it.
 * - **not a structural child.** A condition holds branches and a choice holds options - a narration
 *   line in either is not a legal tree, so those rows keep the plain delete.
 */
export function planRowBackspaceReplacement(
    scene: StoryScene,
    ids: StoryBlockId[],
): { replaceBlockId: StoryBlockId; target: StoryBlockTarget } | null {
    if (ids.length !== 1) {
        return null;
    }
    const block = scene.blocks[ids[0]];
    if (!block || isTextEditableBlock(block) || block.childrenIds.length > 0) {
        return null;
    }
    const parent = block.parentId ? scene.blocks[block.parentId] : null;
    if (block.parentId && !acceptsPlainRows(parent)) {
        return null;
    }
    return { replaceBlockId: block.id, target: { parentId: block.parentId, beforeBlockId: block.id } };
}

/**
 * Whether a plain (narration) row is a legal child of this container. Deliberately stricter than
 * `canAcceptChildren`, and for a *semantic* reason: a condition holds branches and a choice holds
 * options, so a narration under either is a shape the compiler's tree contract does not admit.
 *
 * Nothing else enforces that. `insertBlockInScene` would happily land the row — `canAcceptChildren`
 * says yes to every `control` (condition included) and to a `choice` — so this rule is the only thing
 * keeping the illegal tree out; deleting it produces a scene that builds and then fails to compile.
 * `nvl` is the single case that is also mechanically enforced: a container to this module, but not to
 * `canAcceptChildren`, so an insert there throws.
 */
function acceptsPlainRows(parent: StoryBlock | null | undefined): boolean {
    if (!parent) {
        return false;
    }
    if (parent.kind === "control") {
        return parent.payload.control !== "condition";
    }
    return parent.kind === "nodeAction" && parent.payload.action === "choiceOption";
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
