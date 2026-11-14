import type {
    StoryBlock,
    StoryBlockId,
    StoryConditionRef,
    StoryExpr,
    StoryScene,
    StorySceneId,
    StoryTextSegment,
    StoryVariableRef,
} from "@shared/types/story";
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

/**
 * Copy a subtree onto fresh ids - block ids and the `textId` of every text segment in it.
 *
 * The text ids have to be new: a `textId` is the id of a translation unit AND of a voice unit, and
 * two rows sharing one would share whatever any language says about them and whichever recording
 * either of them was given. `textIds` collects what that renaming did, old id → new id, for the
 * callers that have to follow a line across it - the translations copied with the rows are keyed by
 * the ids they had over there (see `storyTranslationTransfer`), and so are the takes those lines
 * already have in this project (see `storyVoiceTransfer`). Passing nothing collects nothing.
 */
export function cloneSerializedBlock(
    source: SerializedStoryBlock,
    generateId: () => string,
    textIds?: Map<string, string>,
): SerializedStoryBlock {
    return cloneSerializedBlocks([source], generateId, textIds)[0];
}

/** Clone a selection together so references between its rows follow the copied creators. */
export function cloneSerializedBlocks(
    sources: readonly SerializedStoryBlock[],
    generateId: () => string,
    textIds?: Map<string, string>,
): SerializedStoryBlock[] {
    const blockIds = new Map<StoryBlockId, StoryBlockId>();
    const variables = new Map<string, StoryBlockId>();
    const options = new Map<StoryBlockId, StoryBlockId>();
    const cloneTree = (source: SerializedStoryBlock): SerializedStoryBlock => {
        const block = structuredCloneBlock(source.block);
        block.id = generateId();
        blockIds.set(source.block.id, block.id);
        block.parentId = null;
        block.childrenIds = [];
        block.payload = clonePayloadWithNewTextIds(block.payload, generateId, textIds);
        if (block.kind === "declaration") {
            block.payload.storageKey = block.id;
            variables.set(`${block.payload.scope}:${source.block.id}`, block.id);
        } else if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
            options.set(source.block.id, block.id);
        }
        return { block, children: source.children.map(cloneTree) };
    };
    const clones = sources.map(cloneTree);
    const rebindTree = ({ block, children }: SerializedStoryBlock): void => {
        rebindCopiedReferences(block, variables, options);
        if (block.kind === "action") {
            const payload = block.payload;
            if (payload.action === "image" || payload.action === "text" || payload.action === "displayable"
                || payload.action === "audio" || payload.action === "video" || payload.action === "vfx") {
                const target = payload.target;
                const mapped = target?.sourceBlockId && blockIds.get(target.sourceBlockId);
                if (target && !target.builtin && mapped) {
                    target.sourceBlockId = mapped;
                }
            }
        }
        children.forEach(rebindTree);
    };
    clones.forEach(rebindTree);
    return clones;
}

/** Rebind story-owned references; literal and plugin data stay verbatim. */
function rebindCopiedReferences(
    block: StoryBlock,
    variables: ReadonlyMap<string, string>,
    options: ReadonlyMap<string, string>,
): void {
    const variable = (ref: StoryVariableRef | undefined) => {
        if (ref) {
            ref.variableId = variables.get(`${ref.scope}:${ref.variableId}`) ?? ref.variableId;
        }
    };
    const expression = (node: StoryExpr): void => {
        switch (node.kind) {
            case "var": variable(node.target); break;
            case "visited":
                if (node.target.kind === "option") {
                    node.target.blockId = options.get(node.target.blockId) ?? node.target.blockId;
                }
                break;
            case "unary": expression(node.operand); break;
            case "binary": expression(node.left); expression(node.right); break;
            case "ternary": expression(node.test); expression(node.consequent); expression(node.alternate); break;
            case "call": node.args.forEach(expression); break;
            case "array": node.items.forEach(expression); break;
            case "index": expression(node.target); expression(node.index); break;
        }
    };
    const condition = (ref: StoryConditionRef | undefined) => {
        if (ref?.kind === "variable") variable(ref.target);
        if (ref?.kind === "expression") expression(ref.expression.ast);
    };

    for (const segment of payloadTextSegments(block.payload)) {
        for (const run of segment.rich ?? []) {
            if (!("interpolation" in run)) continue;
            if (run.interpolation.kind === "variable") variable(run.interpolation.target);
            if (run.interpolation.kind === "expression") expression(run.interpolation.expression.ast);
        }
    }
    if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
        condition(block.payload.hiddenWhen);
        condition(block.payload.disabledWhen);
    } else if (block.kind === "action") {
        const payload = block.payload;
        if (payload.action === "setVariable") {
            variable(payload.target);
            if (payload.expression) expression(payload.expression.ast);
        } else if (payload.action === "page" || (payload.action === "input" && "resultTarget" in payload)) {
            variable(payload.resultTarget);
        }
    } else if (block.kind === "control") {
        const payload = block.payload;
        if (payload.control === "conditionBranch") condition(payload.condition);
        if (payload.control === "repeat") condition(payload.until);
    }
}

/**
 * The text-segment ids the given blocks carry, in the order they are met, each once.
 *
 * Read off the same fields {@link cloneSerializedBlock} renames, so what a copy carries translations
 * and takes for, and what a paste re-keys them onto, can never describe two different sets of lines.
 */
export function listBlockTextIds(blocks: Iterable<StoryBlock>): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const block of blocks) {
        for (const segment of payloadTextSegments(block.payload)) {
            if (segment.textId && !seen.has(segment.textId)) {
                seen.add(segment.textId);
                ids.push(segment.textId);
            }
        }
    }
    return ids;
}

/**
 * One cloned subtree as a flat list of insertions, **a container before the rows inside it**.
 *
 * The order is what lets the whole tree be one operation rather than one per row: every entry after
 * the first may name an earlier entry as its parent, and both the document mutator and a live
 * session's host rely on the parent being placed by the time its child is. See
 * `StoryService.insertBlocks`.
 */
export function flattenSerializedClone(
    source: SerializedStoryBlock,
    target: StoryBlockTarget,
    into: { block: StoryBlock; target: StoryBlockTarget }[] = [],
): { block: StoryBlock; target: StoryBlockTarget }[] {
    into.push({ block: source.block, target });
    for (const child of source.children) {
        flattenSerializedClone(child, { parentId: source.block.id }, into);
    }
    return into;
}

export function exportBlockPlainText(block: StoryBlock, characters: Character[], scenes?: Record<StorySceneId, StoryScene>): string {
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
    if (block.kind === "empty") {
        // A blank line copies as a blank line. Falling through would put the words "Blank line" into
        // the author's clipboard, which is a description of the row rather than the row.
        return "";
    }
    return `[${getBlockBadgeInfo(block).label}] ${describeBlock(block, characters, undefined, scenes)}`;
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

/**
 * Whether a parsed clipboard payload is one of ours, and has rows in it.
 *
 * The parameter is `unknown` because the value came off the system clipboard: another Studio wrote
 * it, of another version, and nothing about its shape is promised. Only the two fields the paste
 * cannot proceed without are checked here - the optional ones a foreign paste reads are each
 * rebuilt from whatever arrived, at the point they are read.
 */
export function isStoryClipboardPayload(payload: unknown): payload is StoryClipboardPayload {
    if (!payload || typeof payload !== "object") {
        return false;
    }
    const { kind, roots } = payload as { kind?: unknown; roots?: unknown };
    return kind === "narraleaf.story.actions" && Array.isArray(roots) && roots.length > 0;
}

function structuredCloneBlock(block: StoryBlock): StoryBlock {
    return JSON.parse(JSON.stringify(block)) as StoryBlock;
}

function clonePayloadWithNewTextIds(
    payload: StoryBlock["payload"],
    generateId: () => string,
    textIds?: Map<string, string>,
): StoryBlock["payload"] {
    const clone = JSON.parse(JSON.stringify(payload)) as StoryBlock["payload"];
    for (const segment of payloadTextSegments(clone)) {
        const previous = segment.textId;
        segment.textId = generateId();
        if (previous) {
            textIds?.set(previous, segment.textId);
        }
    }
    return clone;
}

/**
 * The text segments of one payload: the two fields a row's translatable line can occupy.
 *
 * One walk rather than one per caller, so a payload that grows a third such field is served by a
 * single edit instead of by several that have to be remembered together.
 */
function payloadTextSegments(payload: StoryBlock["payload"]): StoryTextSegment[] {
    const record = payload as unknown as Record<string, unknown>;
    const segments: StoryTextSegment[] = [];
    for (const field of TEXT_SEGMENT_FIELDS) {
        const value = record[field];
        if (isStoryTextSegment(value)) {
            segments.push(value);
        }
    }
    return segments;
}

const TEXT_SEGMENT_FIELDS = ["text", "prompt"] as const;

function isStoryTextSegment(value: unknown): value is StoryTextSegment {
    return Boolean(value && typeof value === "object" && "textId" in value && "value" in value);
}
