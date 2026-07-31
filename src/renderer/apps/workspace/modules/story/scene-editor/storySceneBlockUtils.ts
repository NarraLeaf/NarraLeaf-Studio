import { Aperture, Bookmark, Clock, Code, CornerUpLeft, Eye, FileText, GitBranch, Image, Layers, MessageSquare, Move, Music, Puzzle, Route, Settings2, Sparkles, StickyNote, TriangleAlert, Type, UserRound, Variable, Video, Wind } from "lucide-react";
import type { StoryBlock, StoryBlockId, StoryRichRun, StoryScene, StorySceneId, StoryTextSegment } from "@shared/types/story";
import { richIfMeaningful } from "./richText";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { CharacterAppearanceRef, StoryBlockTarget, StoryStagePlacement, VisibleStoryRow } from "./storySceneEditorTypes";
import {
    describeStoryBlock,
    getStoryEmptyTextPlaceholder,
    getStorySceneName,
    getStoryTextSegment,
    storyBlockBadge,
    storyRowAccentColor,
    type StoryBlockBadgeId,
    type StoryRowLookups,
} from "@/lib/story/storyRowProjection";
import { translate } from "@/lib/i18n";

/**
 * The row projection moved to `@/lib/story/storyRowProjection` (U4 WI-1) so the Dev Mode timeline can
 * read the same sentence the editor shows. What stays here is the editor's own half: the `Character[]`
 * service adapters, the lucide icons, and the reading-layer passes (dialogue groups, visible rows).
 */
export {
    getStoryContainerHeaderInfo as getContainerHeaderInfo,
    type StoryContainerHeaderInfo,
    type StoryContainerRole,
} from "@/lib/story/storyRowProjection";

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
                current.set(characterId, { pose: block.payload.pose, tags: block.payload.tags, position, positionSourceId: block.id, shown: true });
            } else if (block.payload.operation === "expression") {
                // An expression changes the appearance but not where the character stands, so the
                // accumulated placement (and the row that owns it) is preserved. Tags merge rather
                // than replace: the row names only the axes it changes, exactly as the engine treats
                // them, so the outfit an earlier row chose has to survive a mood change here.
                const previous = current.get(characterId);
                current.set(characterId, {
                    ...previous,
                    pose: block.payload.pose ?? previous?.pose,
                    tags: previous?.tags || block.payload.tags ? { ...previous?.tags, ...block.payload.tags } : undefined,
                    shown: true,
                });
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
 * `groupContinues` is set on any row of a run whose very next row is still one of its members — heads
 * and members alike. It is not a grouping rule (the runs are exactly the ones the loop below already
 * found), only the one fact a row cannot see about itself: whether the attribution rail has to leave
 * its bottom edge. A head without it never reaches the lines it attributes; a MEMBER without it is
 * the last line of the run, which is what lets the rail finish with an end instead of running off the
 * bottom of the last row into whatever follows.
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
        row.groupRole !== undefined && annotated[index + 1]?.groupRole === "member"
            ? { ...row, groupContinues: true }
            : row);
}

/**
 * Records each row's successor depth, which is what lets a nesting connector know where to stop.
 *
 * The visible list is a preorder flattening, so the branch at level L ends at row `i` exactly when the
 * next row sits at depth L or shallower — one lookahead, no tree walk. The last row ends every branch,
 * hence the 0.
 */
export function annotateNestingBranches(rows: VisibleStoryRow[]): VisibleStoryRow[] {
    return rows.map((row, index) => ({ ...row, nextRowDepth: rows[index + 1]?.depth ?? 0 }));
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

export const getTextSegment = getStoryTextSegment;

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

/**
 * The badge icons stay here, with the rest of the editor's React. Everything that decides WHICH badge
 * a row wears - its id, its label key and its colour group - is `storyBlockBadge` in the shared row
 * projection, so the editor's left-edge bar and the Dev Mode timeline's hue can never come from two
 * different chains of ifs (U4 WI-1).
 */
const BADGE_ICONS: Record<StoryBlockBadgeId, typeof FileText> = {
    narration: FileText,
    dialogue: MessageSquare,
    choice: GitBranch,
    choiceOption: Route,
    background: Image,
    character: UserRound,
    audio: Music,
    variable: Variable,
    wait: Clock,
    image: Image,
    transform: Move,
    displayable: Eye,
    text: Type,
    layer: Layers,
    video: Video,
    vfx: Wind,
    nvl: FileText,
    blueprint: Puzzle,
    camera: Aperture,
    effect: Sparkles,
    label: Bookmark,
    goto: CornerUpLeft,
    control: Settings2,
    jump: Route,
    code: Code,
    invalid: TriangleAlert,
    declaration: Variable,
    note: StickyNote,
};

/**
 * The row's badge and its left-edge colour bar. `iconColor` comes from the command GROUP (see
 * `storyCommandCategories.ts`), which is why the 13→8 rearrangement changed almost nothing here: the
 * four stage subjects stayed separate colour units precisely so this surface would not lose the
 * distinctions it earns. The two rows that did change category changed on purpose - a screen effect
 * belongs to the scene, a blueprint call is a tool.
 */
export function getBlockBadgeInfo(block: StoryBlock): { label: string; icon: typeof FileText; iconColor: string } {
    const badge = storyBlockBadge(block);
    return { label: translate(badge.labelKey), icon: BADGE_ICONS[badge.id], iconColor: storyRowAccentColor(block) };
}

/**
 * The structural character lookup the shared row projection takes, backed by the workspace service.
 *
 * This IS the coupling the shared projection was extracted to break: `Character` is a service class
 * with a `profile`, and Dev Mode has nothing of the sort (only `DevModeCharacterSummary`). Only three
 * of its methods were ever used, so the projection asks for those three values rather than for the
 * object that happens to hold them here.
 */
export function characterRowLookup(characters: Character[]): StoryRowLookups["character"] {
    return characterId => {
        const character = characters.find(candidate => candidate.profile.getId() === characterId);
        if (!character) {
            return null;
        }
        const color = character.profile.getColor();
        return color && isReadableAccentColor(color)
            ? { name: character.profile.getName(), color }
            : { name: character.profile.getName() };
    };
}

export function describeBlock(block: StoryBlock, characters: Character[], scene?: StoryScene, scenes?: Record<StorySceneId, StoryScene>): string {
    return describeStoryBlock(block, { character: characterRowLookup(characters), scene, scenes });
}

/**
 * {@link describeBlock} for the right rail's subject line: the same sentence, with asset ids resolved
 * to asset names.
 *
 * A row can say `Set background 4b645b59-1723-4ac9-98ab-e6859b837bef` because the *payload* stores an
 * id and the projection is pure - it has no way to reach the asset table. In the list that is
 * tolerable (a background row also paints the picture); as the heading of the panel naming what the
 * author is editing, it is nothing but noise. So the resolver is a parameter: the projection stays
 * pure, and the caller, which is in React and has the service, supplies the lookup.
 */
export function describeBlockSubject(
    block: StoryBlock,
    characters: Character[],
    resolveAssetName: (assetId: string) => string | null,
    scene?: StoryScene,
    scenes?: Record<StorySceneId, StoryScene>,
): string {
    return describeStoryBlock(block, {
        character: characterRowLookup(characters),
        assetName: resolveAssetName,
        scene,
        scenes,
    });
}

export const getEmptyTextPlaceholder = getStoryEmptyTextPlaceholder;

export const getSceneName = getStorySceneName;

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
