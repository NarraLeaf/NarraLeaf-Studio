import { Aperture, Blocks,
    Bookmark, Clock, CornerUpLeft, Eye, FileText, GitBranch, Image, Layers, LogOut, MessageSquare, Move, Music, Puzzle, Route, SeparatorHorizontal, Settings2, Sparkles, StickyNote, TriangleAlert, Type, UserRound, Variable, Video, Wind } from "lucide-react";
import { resolveBrandColorValue } from "@shared/brand/brandRegistry";
import type { StoryBlock, StoryBlockId, StoryRichRun, StoryScene, StorySceneId, StoryTextSegment } from "@shared/types/story";
import { storyVariableRefKey } from "@shared/types/story";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { richIfMeaningful } from "./richText";
import { paragraphActionCharacterId } from "./storyCharacterActions";
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
import { storyVerbCommandId } from "@/lib/story/storyVerbVocabulary";
import { translate } from "@/lib/i18n";
import { getCommandSpec } from "./commands/registry";
import { DECLARATION_COMMANDS } from "./commands/specs/variables";

/**
 * The row projection moved to `@/lib/story/storyRowProjection` so the Dev Mode timeline can
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
                // own block is the row the group-header dropdown rewrites.
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
 * The two layers a row can belong to (gutter 规范 §1) — the first and coarsest thing the eye is asked
 * to decide, and the one the row's BACKGROUND carries.
 *
 * The original arrangement laid narration, dialogue and directives out as three peers, which is why
 * narration had nowhere to live: it is not a kind of dialogue and it is certainly not a directive. It
 * is two questions, not one.
 *
 *  - `"script"` — words that get performed. Whether a specific person says them (dialogue) or nobody
 *    does (narration) is the SECOND question, and the gutter mark answers it.
 *  - `"machine"` — everything that never reaches the player as speech: directives, control flow,
 *    variable declarations, studio notes, and unresolved drafts. It takes a tint so it steps out of
 *    the narrative flow, which is how the default view reads as very nearly a plain script.
 *
 * A choice and its options file under `"machine"` despite showing the player words, and that is a
 * judgement rather than an oversight: in this editor those rows ARE the branching structure — they
 * hold children, fold, and carry conditions — so they read as the machinery that presents a choice
 * rather than as a line somebody speaks. Their words are still in the row, in full.
 */
export type StoryRowLayer = "script" | "machine";

/** Which of the two layers a row belongs to. A whitelist: a new kind is machinery until argued otherwise. */
export function storyRowLayer(block: StoryBlock): StoryRowLayer {
    if (block.kind === "nodeAction") {
        const action = block.payload.action;
        return action === "narration" || action === "dialogue" ? "script" : "machine";
    }
    return "machine";
}

/**
 * A voice, for the purpose of deciding where a paragraph starts.
 *
 * `narrator: true` is its own case rather than a reserved name, so no character an author could
 * actually create can collide with it.
 */
type GroupSpeaker = { narrator?: true; characterId?: string; speakerName?: string };

/** Whether two speakers are the same run: the narrator ties with itself; a character id wins; a bare, non-empty name ties otherwise. */
function sameGroupSpeaker(a: GroupSpeaker, b: GroupSpeaker): boolean {
    if (a.narrator || b.narrator) {
        return Boolean(a.narrator && b.narrator);
    }
    if (a.characterId || b.characterId) {
        return Boolean(a.characterId) && a.characterId === b.characterId;
    }
    return Boolean(a.speakerName) && a.speakerName === b.speakerName;
}

/**
 * The speaker a row belongs to a paragraph as, or `null` when it can neither open nor continue one.
 *
 * Narration is here alongside dialogue, and that is the whole change (gutter 规范 §2): a run of
 * consecutive lines in one voice is one paragraph, 不做特例. The narrator is a voice like any other,
 * so its lines group too — named once at the head, joined by the gutter's rule after that. Leaving it
 * out was the old model's tell that narration had never been given a place: it was the one kind of
 * speech that re-announced itself on every single line.
 */
function rowGroupSpeaker(block: StoryBlock): GroupSpeaker | null {
    if (block.kind !== "nodeAction") {
        return null;
    }
    if (block.payload.action === "narration") {
        return { narrator: true };
    }
    if (block.payload.action === "dialogue") {
        return { characterId: block.payload.characterId, speakerName: block.payload.speakerName };
    }
    return null;
}

/**
 * Annotate rows with their paragraph role, a pure render projection over the visible sequence.
 *
 * A run is consecutive rows in the same voice — narration, or one character's dialogue — *under the
 * same container*; a row acting on that same character rides along without breaking it (see
 * `paragraphActionCharacterId`, which is also where "acting on" stops and "staging" begins). Any
 * other kind, a change of voice, or a change of `parentId` ends the run, so an option body's last
 * line never groups with a same-speaker line that lives outside the container (adjacency in the
 * flattened list is not adjacency in the tree). Only rows inside a run are cloned; every other row is
 * returned untouched, so referential identity is preserved where it can be.
 *
 * `characters` is only ever consulted to resolve a displayable target's NAME back to a character, so
 * a caller with no cast to hand (a test, a projection that has none) can pass an empty list and lose
 * exactly that one case.
 *
 * `groupContinues` is set on any row of a run whose very next row is still one of its members — heads
 * and members alike. It is not a grouping rule (the runs are exactly the ones the loop below already
 * found), only the one fact a row cannot see about itself: whether its paragraph carries on past its
 * own bottom edge, which is what tells the gutter's continuation rule how far to run.
 */
export function annotateDialogueGroups(rows: VisibleStoryRow[], characters: readonly Character[] = []): VisibleStoryRow[] {
    let groupSpeaker: GroupSpeaker | null = null;
    let groupParentId: StoryBlockId | null = null;
    const annotated = rows.map(row => {
        const block = row.block;
        const parentId = block.parentId ?? null;
        const sameContainer = groupSpeaker !== null && groupParentId === parentId;
        const speaker = rowGroupSpeaker(block);
        if (speaker) {
            if (sameContainer && sameGroupSpeaker(groupSpeaker!, speaker)) {
                return { ...row, groupRole: "member" as const };
            }
            groupSpeaker = speaker;
            groupParentId = parentId;
            return { ...row, groupRole: "head" as const };
        }
        if (
            sameContainer
            && groupSpeaker!.characterId
            && paragraphActionCharacterId(block, characters) === groupSpeaker!.characterId
        ) {
            // Something done to the group's own speaker: still their paragraph, so the run continues
            // and the row wears its rule rather than a directive's glyph.
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

/**
 * The rows to draw, each carrying the number the gutter prints beside it.
 *
 * **The number counts the scene, not the screen.** Every block in the scene consumes one, including
 * the ones folded away inside a collapsed container - so a collapsed container leaves a gap in the
 * sequence, exactly as folding a region in a code editor does, and a row keeps its number whatever
 * the reader has open. Two things depend on that:
 *
 *  - The narrative filter already promised it (`filter then group` in the tests): hiding staging rows
 *    leaves the survivors on 1 and 3, not renumbered to 1 and 2.
 *  - The lint report names rows by that number (`lib/lint/storyLocator.ts`), and a report that said
 *    "line 12" about a row this gutter called 9 because something above it was folded would be
 *    worse than a report that said nothing at all.
 */
export function buildVisibleRows(scene: StoryScene, collapsedIds: Set<StoryBlockId>): VisibleStoryRow[] {
    const rows: VisibleStoryRow[] = [];
    let lineNumber = 0;
    const visit = (blockId: StoryBlockId, depth: number, disabledAncestor: boolean, visible: boolean) => {
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        // Disabled propagates down: a disabled container's whole subtree renders muted (and compiles
        // out), so a row is effectively disabled when it or any ancestor is (schema v7).
        const disabled = disabledAncestor || Boolean(block.disabled);
        lineNumber += 1;
        if (visible) {
            rows.push(disabled ? { block, depth, lineNumber, disabled } : { block, depth, lineNumber });
        }
        // Descend even when nothing below will be drawn: those rows still take their numbers.
        const childrenVisible = visible && !collapsedIds.has(blockId);
        block.childrenIds.forEach(childId => visit(childId, depth + 1, disabled, childrenVisible));
    };
    scene.rootBlockIds.forEach(blockId => visit(blockId, 0, false, true));
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

/** Where a moving group lands, and the order its rows are inserted in. See {@link planBlockGroupMove}. */
export interface StoryBlockGroupMove {
    /** The roots to move, in document order. Every one is inserted at {@link target}, in this order. */
    blockIds: StoryBlockId[];
    target: StoryBlockTarget;
}

/** The ids in `ids`, in the order a reader meets them walking the scene. */
function inDocumentOrder(scene: StoryScene, ids: Set<StoryBlockId>): StoryBlockId[] {
    const ordered: StoryBlockId[] = [];
    const visit = (blockId: StoryBlockId) => {
        if (ids.has(blockId)) {
            ordered.push(blockId);
        }
        for (const childId of scene.blocks[blockId]?.childrenIds ?? []) {
            visit(childId);
        }
    };
    scene.rootBlockIds.forEach(visit);
    return ordered;
}

/** The member of `ancestors` that contains `blockId` (or is it), else null. */
function enclosingId(scene: StoryScene, blockId: StoryBlockId, ancestors: Set<StoryBlockId>): StoryBlockId | null {
    let id: StoryBlockId | null = blockId;
    while (id) {
        if (ancestors.has(id)) {
            return id;
        }
        id = scene.blocks[id]?.parentId ?? null;
    }
    return null;
}

/**
 * Where a dropped selection lands: one target for the whole group, plus the order to apply it in.
 *
 * A single row had an easy time of it: take the row out of its siblings and read off the next one. A
 * group cannot, because the row after the drop point may be *another member of the group*, and an
 * anchor that is about to move is an anchor `insertId` will not find: it appends instead, and the
 * group silently scatters to the end of the parent. So the anchor here is the first sibling at or
 * after the drop point that is NOT moving, which is stable for the whole run of inserts.
 *
 * Which side of `targetBlockId` the group lands on follows the row the author actually grabbed, the
 * way a sortable list behaves: dragging downwards drops *after* the row under the pointer, upwards
 * drops *before* it.
 *
 * Returns null when the drop cannot mean anything: an empty selection, a target that is one of the
 * moving rows, or a target inside a moving row's own subtree (a container cannot be moved into itself).
 */
export function planBlockGroupMove(
    scene: StoryScene,
    movingIds: StoryBlockId[],
    grabbedBlockId: StoryBlockId,
    targetBlockId: StoryBlockId,
): StoryBlockGroupMove | null {
    const roots = filterOutSelectedDescendants(scene, [...new Set(movingIds)]);
    const target = scene.blocks[targetBlockId];
    if (roots.length === 0 || !target) {
        return null;
    }
    const rootSet = new Set(roots);
    if (enclosingId(scene, targetBlockId, rootSet)) {
        return null;
    }
    const siblings = target.parentId ? scene.blocks[target.parentId]?.childrenIds : scene.rootBlockIds;
    const targetIndex = siblings?.indexOf(targetBlockId) ?? -1;
    if (!siblings || targetIndex === -1) {
        return null;
    }
    const blockIds = inDocumentOrder(scene, rootSet);
    // The grabbed row tells us the direction, but a row grabbed *inside* a moving container is not
    // itself a root — the container's own position is the one being dragged, so ask for that instead.
    const grabbedRoot = enclosingId(scene, grabbedBlockId, rootSet) ?? blockIds[0];
    const order = inDocumentOrder(scene, new Set([grabbedRoot, targetBlockId]));
    const draggingDown = order.indexOf(grabbedRoot) < order.indexOf(targetBlockId);
    const anchorIndex = draggingDown ? targetIndex + 1 : targetIndex;
    const beforeBlockId = siblings.slice(anchorIndex).find(id => !rootSet.has(id)) ?? null;
    return { blockIds, target: { parentId: target.parentId, beforeBlockId } };
}

/**
 * One step of Alt+Up / Alt+Down over a selection: every selected row steps over the neighbour on that
 * side, staying in its own parent — the keyboard nudge, as opposed to the drag, which drops the whole
 * selection in one place.
 *
 * The unit that steps is a RUN of adjacent selected siblings, not a row: three rows selected in a row
 * hop the one line above them together. Moving them individually would walk each over the line above
 * it, which for the middle rows is another selected row — the selection would shuffle inside itself and
 * come out reordered. Split selections keep their gaps, so Alt+Down then Alt+Up is exactly where you
 * started; a scene surgery that cannot be taken back by the opposite key is not a nudge.
 *
 * Each run's anchor is a row that is NOT moving, and only runs move, so the groups can be applied in
 * any order and every anchor is still there when its turn comes.
 *
 * Returns null when the selection cannot move as a whole: something is already against the end of its
 * parent. All or nothing, again so the opposite key undoes it — letting the rows that can move move
 * would silently close a gap the author would have to rebuild by hand.
 */
export function planSelectionNudge(
    scene: StoryScene,
    movingIds: StoryBlockId[],
    direction: "up" | "down",
): StoryBlockGroupMove[] | null {
    const roots = filterOutSelectedDescendants(scene, [...new Set(movingIds)]);
    if (roots.length === 0) {
        return null;
    }
    const rootSet = new Set(roots);
    const moves: StoryBlockGroupMove[] = [];
    // Runs are per parent: a selection that spans a container's body and the rows after it is two runs,
    // and each stays where it is in the tree.
    const parents = new Set(roots.map(id => scene.blocks[id]?.parentId ?? null));
    for (const parentId of parents) {
        const siblings = parentId ? scene.blocks[parentId]?.childrenIds : scene.rootBlockIds;
        if (!siblings) {
            return null;
        }
        for (let index = 0; index < siblings.length;) {
            if (!rootSet.has(siblings[index])) {
                index += 1;
                continue;
            }
            let end = index;
            while (end + 1 < siblings.length && rootSet.has(siblings[end + 1])) {
                end += 1;
            }
            const blockIds = siblings.slice(index, end + 1);
            if (direction === "up") {
                const previousId = siblings[index - 1];
                if (!previousId) {
                    return null;
                }
                moves.push({ blockIds, target: { parentId, beforeBlockId: previousId } });
            } else {
                const nextId = siblings[end + 1];
                if (!nextId) {
                    return null;
                }
                // Past the neighbour, and past any further selected rows — the next run's rows are
                // moving too, and an anchor that moves is one `insertId` will not find.
                const beforeBlockId = siblings.slice(end + 2).find(id => !rootSet.has(id)) ?? null;
                moves.push({ blockIds, target: { parentId, beforeBlockId } });
            }
            index = end + 1;
        }
    }
    return moves.length > 0 ? moves : null;
}

export function canAcceptChildren(block: StoryBlock | undefined): boolean {
    if (!block) {
        return false;
    }
    // `label`, `goto`, `break` and `cut` are the control rows that are NOT containers: a label is a
    // point, a goto is a move, a break is an exit and a cut is an ending - none has a body.
    // Everything else under `control` groups rows.
    if (block.kind === "control"
        && (block.payload.control === "label" || block.payload.control === "goto"
            || block.payload.control === "break" || block.payload.control === "cut")) {
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
 * different chains of ifs.
 *
 * These are now the FALLBACK: a row that maps to a command wears that command's own glyph
 * ({@link rowCommandId}), so the plate matches the entry in the `/` menu that could have written the
 * line. A badge id is coarser than a command by design - one `audio` badge covers ten verbs - so
 * reading the icon from it alone gave every sound row the same note. What is left here is the rows no
 * command owns (narration, a choice option, an invalid line) and the safety net for any that stop
 * resolving.
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
    plugin: Blocks,
    camera: Aperture,
    effect: Sparkles,
    label: Bookmark,
    goto: CornerUpLeft,
    break: LogOut,
    cut: SeparatorHorizontal,
    control: Settings2,
    jump: Route,
    invalid: TriangleAlert,
    declaration: Variable,
    note: StickyNote,
};

/**
 * The command whose glyph this row wears, or `null` for the rows no command writes.
 *
 * `storyVerbCommandId` already states the block→command relation for action payloads - it is what
 * makes a committed row say "Hide" where the author typed `/hide` - so the plate reads the very same
 * table rather than a second one that could disagree with the words beside it. The rest of this
 * function is the kinds that table does not cover, because they are not `StoryActionPayload`s: a
 * container, a jump, a declaration, a note.
 *
 * Two action payloads get an answer the verb table declines to give, and for the same reason in both
 * cases - the table names the word a ROW SAYS, and stays silent where naming one would be wrong,
 * while a plate only has to point at the command that could have written the line:
 *
 *  - `blueprint` has no verb of its own to print, but `/blueprint` is unambiguously its command;
 *  - a `displayable` operation outside show/hide/transform (mask, clip, blend …) is inspector-reached
 *    and has no typed word, yet every one of them arrives through `/fx`.
 */
function rowCommandId(block: StoryBlock): string | null {
    switch (block.kind) {
        case "action":
            if (block.payload.action === "blueprint") {
                return "blueprint";
            }
            if (block.payload.action === "displayable") {
                return storyVerbCommandId(block.payload) ?? "fx";
            }
            return storyVerbCommandId(block.payload);
        case "nodeAction":
            // Narration and a choice option are text rows, not commands - `/say` writes a dialogue and
            // `/menu` writes the choice, but nothing writes the option except Enter inside one.
            if (block.payload.action === "dialogue") return "say";
            if (block.payload.action === "choice") return "menu";
            return null;
        case "control":
            switch (block.payload.control) {
                // A branch belongs to its container's command: `/if` is what puts both rows there.
                case "condition":
                case "conditionBranch": return "if";
                // One payload, two commands: `until` present IS the conditional form (see the payload's
                // note), which is `/until` - the same flag the container header reads.
                case "repeat": return block.payload.until ? "until" : "repeat";
                case "parallel": return "parallel";
                case "race": return "race";
                case "sequence": return "sequence";
                case "break": return "break";
                case "cut": return "cut";
                case "label": return "label";
                case "goto": return "goto";
                default: return null;
            }
        case "jump":
            return "jump";
        case "declaration":
            return DECLARATION_COMMANDS[block.payload.scope] ?? null;
        case "note":
            return "note";
        default:
            return null;
    }
}

/**
 * The row's badge and its left-edge colour bar.
 *
 * `iconColor` comes from the command GROUP (see `storyCommandCategories.ts`), which is why the 13→8
 * rearrangement changed almost nothing here: the four stage subjects stayed separate colour units
 * precisely so this surface would not lose the distinctions it earns. The two rows that did change
 * category changed on purpose - a screen effect belongs to the scene, a blueprint call is a tool.
 *
 * The icon comes from the COMMAND (see {@link rowCommandId}), so the two say different things: the
 * hue files the row by subject, the glyph names the verb. It used to come from the badge id, which is
 * one step coarser than a command in exactly the places an author looks hardest - ten sound verbs
 * under one `audio` badge, eight character verbs under one `character` - so a scene of `/bgm`, `/vol`
 * and `/stop` rows wore three identical notes.
 */
export function getBlockBadgeInfo(block: StoryBlock): { label: string; icon: typeof FileText; iconColor: string } {
    const badge = storyBlockBadge(block);
    const commandId = rowCommandId(block);
    const commandIcon = commandId ? getCommandSpec(commandId)?.icon : null;
    return {
        label: translate(badge.labelKey),
        icon: commandIcon ?? BADGE_ICONS[badge.id],
        iconColor: storyRowAccentColor(block),
    };
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
        const color = readableAccentColor(character.profile.getColor());
        return color
            ? { name: character.profile.getName(), color }
            : { name: character.profile.getName() };
    };
}

/**
 * The project-variable name lookup the shared row projection takes, backed by the variable registry.
 *
 * The second coupling `characterRowLookup` breaks, for the same reason: the registry is a workspace
 * service and the projection is pure. Keyed the way each scope's ref addresses its entry - `saved` by
 * entry id, `persistent` by storage key - so one table answers for both scopes and no call site has
 * to remember which is which.
 */
export function projectVariableNameLookup(
    entries: readonly VariableRegistryEntry[],
): NonNullable<StoryRowLookups["projectVariableName"]> {
    const names = new Map(entries.map(entry => [
        storyVariableRefKey({
            scope: entry.scope,
            variableId: entry.scope === "persistent" ? entry.storageKey : entry.id,
        }),
        entry.name,
    ]));
    return (scope, variableId) => names.get(storyVariableRefKey({ scope, variableId })) ?? null;
}

export function describeBlock(
    block: StoryBlock,
    characters: Character[],
    scene?: StoryScene,
    scenes?: Record<StorySceneId, StoryScene>,
    projectVariableName?: StoryRowLookups["projectVariableName"],
): string {
    return describeStoryBlock(block, { character: characterRowLookup(characters), scene, scenes, projectVariableName });
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
    resolveMotionName?: (animationId: string) => string | null,
    projectVariableName?: StoryRowLookups["projectVariableName"],
): string {
    return describeStoryBlock(block, {
        character: characterRowLookup(characters),
        assetName: resolveAssetName,
        scene,
        scenes,
        motionName: resolveMotionName,
        projectVariableName,
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
 * What a *stored* character accent paints as in Studio's own chrome, or `undefined` when nothing
 * should be painted.
 *
 * Two steps, and the order is the whole point. A profile's `color` may be a `nlbrand:` link at the
 * project palette rather than a hex literal, so it is resolved first; only then is the resolved
 * literal put to {@link isReadableAccentColor}. Asking the band about the link itself would fail —
 * `nlbrand:primary` is not a hex, and the band is right to say so — and the author would watch a
 * character they had just given a brand colour go grey in every Studio surface at once.
 *
 * Every Studio chrome surface that tints something with a character's accent goes through here
 * rather than repeating the pair, because "resolve, then band" being two calls is exactly how one
 * surface ends up a step behind the others.
 *
 * A palette entry that is not itself a plain hex (a translucent one such as `button.shadow`) still
 * comes back `undefined`: the band's question has not changed, and a half-transparent nametag was
 * never a thing any of these surfaces could honour.
 */
export function readableAccentColor(stored: string | null | undefined): string | undefined {
    const resolved = resolveBrandColorValue(stored);
    return resolved && isReadableAccentColor(resolved) ? resolved : undefined;
}

/**
 * The editor accent colour a character carries, or `undefined` when none is set — or when the one set
 * would be unreadable on either theme's surface, in which case the nametag keeps the default ink
 * rather than disappearing into the background (see {@link readableAccentColor}).
 */
export function getCharacterColor(characters: Character[], characterId: string | undefined): string | undefined {
    if (!characterId) {
        return undefined;
    }
    return readableAccentColor(characters.find(character => character.profile.getId() === characterId)?.profile.getColor());
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
