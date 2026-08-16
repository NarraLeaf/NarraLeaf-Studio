/**
 * The reconciler: an edited script becomes the scene it was printed from, minus the lines nobody touched.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * ## Why re-parsing the scene is not an option
 *
 * `print` then `parse` is semantically faithful and structurally lossy - deliberately so, and the
 * losses are pinned in `narralangRoundTrip.test.ts`. A `displayable show` aimed at a named object comes
 * back as the typed row (`image show`); a condition stored as `kind: "variable"` comes back as
 * `kind: "expression"`; a `sequence` carrying an explicit `do` mode comes back without one; a
 * `setVariable` that has both a `value` and an `expression` loses the dead `value`; two adjacent rich
 * runs with the same marks come back as one; a `transition` of `kind: "none"` disappears. Every one of
 * those says the same thing to the engine and a different thing to a diff.
 *
 * So an author who opens the script view, fixes one typo and saves would rewrite every other row in
 * the scene. The version history would show a scene-wide change; a reviewer would have to read all of
 * it to find the typo; and a colleague's merge would conflict on rows neither of them edited. That is
 * the failure this module exists to prevent, and the acceptance test for it is the single-line edit in
 * `narralangReconcile.test.ts`.
 *
 * ## The mechanism: compare against what the printer WOULD have written
 *
 * Print the scene the author started from, and the result is the line each row would occupy. A line in
 * the new text that is byte-identical to one of those is a line the author did not touch, and its row
 * is returned exactly as it was - same id, same payload, not a field of it rebuilt. Only lines that
 * differ, and lines that are new, go through the parser.
 *
 * `lib/story/script/storyScriptCodec.ts` already proved the mechanism on dialogue rows, where a
 * zero-edit round trip used to drop a speaker binding. This is the same bargain applied to every row.
 *
 * The old text is printed here rather than passed in: a `previousText` parameter is a second copy of
 * the truth, and the moment a caller holds a stale one, rows silently swap payloads.
 *
 * ## Identity flows the other way too
 *
 * A matched line hands its row's id to the parser ({@link NarralangParseOptions.blockIdForLine}), so
 * the parse resolves references BY id - a stage name to the row that created it, a variable to its
 * declaration - onto the rows that are really there. Without that, an untouched `show bird` would come
 * back pointing at a copy of `image create bird` rather than at the row above it.
 *
 * ## All or nothing
 *
 * One diagnostic fails the whole reconcile. Half a scene written into the document is worse than
 * nothing written at all: the rows that did parse would be committed against rows that did not, and
 * the author's undo has one buffer to put back, not two.
 *
 * ## No locale, ever
 *
 * Same rule as the printer and the parser: no `translate`, no localised table.
 */

import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import type { StoryExpressionScope } from "@shared/utils/storyExpressionParser";

import { NARRALANG_DEFAULT_DIALECT, type NarralangDialect } from "./narralangDialect";
import { printNarralangSceneLines, type NarralangLookups } from "./narralangPrinter";
import {
    parseNarralangSceneWithDialect,
    readNarralangScriptLines,
    type NarralangDiagnostic,
    type NarralangParseLookups,
} from "./narralangParse";

/** The parser's diagnostic, under the name the reconcile surface publishes it as. */
export type NarralangParseDiagnostic = NarralangDiagnostic;

export type NarralangReconcileResult =
    | {
        ok: true;
        rootBlockIds: StoryBlockId[];
        blocks: Record<StoryBlockId, StoryBlock>;
        /**
         * The rows the author really changed or created.
         *
         * A row is here when it is new, or when its content (kind, payload, disabled) is not the
         * content it had. Moving a row or re-hanging it under another parent changes neither, so a
         * pure re-order comes back with nothing touched and a different tree - a caller asking "did
         * anything happen?" has to compare {@link rootBlockIds} and the rows' `childrenIds` as well.
         */
        touchedBlockIds: StoryBlockId[];
    }
    | { ok: false; diagnostics: NarralangParseDiagnostic[] };

export type NarralangReconcileInput = {
    /** The scene the text was printed from, and the source of every id the result keeps. */
    scene: StoryScene;
    nextText: string;
    lookups: NarralangLookups;
    parseLookups: NarralangParseLookups;
    dialect?: NarralangDialect;
    /**
     * What `visited(…)`, `picked(…)` and a blueprint call resolve against.
     *
     * Optional, and omitting it costs more here than it does in a plain parse: an expression the scope
     * cannot resolve is a diagnostic, and one diagnostic refuses the whole scene - including one on a
     * row the author never touched.
     */
    expressionScope?: Partial<StoryExpressionScope>;
};

/**
 * Reconcile an edited script against the scene it came from.
 *
 * The scene must be expressible (`printNarralangScene(...).issues` empty), which is the same gate the
 * text view opens on. A row with no NarraLang spelling never reached the text, so reconciling one
 * would delete it without the author having seen it - that is refused rather than performed.
 */
export function reconcileNarralangScene(input: NarralangReconcileInput): NarralangReconcileResult {
    const { scene, nextText, lookups, parseLookups } = input;
    const dialect = input.dialect ?? NARRALANG_DEFAULT_DIALECT;

    const printed = printNarralangSceneLines(scene, lookups, dialect);
    if (printed.issues.length > 0) {
        // Reported against the first line because there is no line to report it against: the rows at
        // fault are the ones that printed nothing. The reason is the parser's catch-all rather than a
        // new member of its closed vocabulary, which would move a table the message catalogue is
        // pinned to; the caller's own gate is what keeps this unreachable in practice.
        return { ok: false, diagnostics: [{ line: 1, column: 1, reason: "unknownStatement" }] };
    }

    const before = printed.lines;
    const after = readNarralangScriptLines(nextText, dialect);
    const pairs = matchScriptLines(before.map((entry) => entry.text), after.map((entry) => entry.source));

    const idForLine = new Map<number, StoryBlockId>();
    const matchedOldIds = new Set<StoryBlockId>();
    for (const [newIndex, oldIndex] of pairs) {
        idForLine.set(after[newIndex].line, before[oldIndex].blockId);
        matchedOldIds.add(before[oldIndex].blockId);
    }

    const parsed = parseNarralangSceneWithDialect(nextText, parseLookups, dialect, {
        blockIdForLine: (line) => idForLine.get(line) ?? null,
        expressionScope: input.expressionScope,
    });
    if (parsed.diagnostics.length > 0) {
        return { ok: false, diagnostics: parsed.diagnostics };
    }

    const blocks: Record<StoryBlockId, StoryBlock> = { ...parsed.blocks };
    const rootBlockIds = [...parsed.rootBlockIds];
    reclaimContainers(scene, blocks, rootBlockIds, matchedOldIds);

    const present = new Set(Object.keys(blocks));
    const oldIds = new Set(Object.keys(scene.blocks));
    // The tree as the parser left it, kept aside: the loop below overwrites payloads, and every
    // question asked about the new tree has to get the same answer whether it is asked first or last.
    const parsedTree = { ...blocks };
    const touchedBlockIds: StoryBlockId[] = [];
    for (const id of documentOrder(rootBlockIds, blocks)) {
        const previous = scene.blocks[id];
        const fresh = blocks[id];
        if (previous === undefined || !reusable(previous, fresh, scene, parsedTree, oldIds, present)) {
            touchedBlockIds.push(id);
            continue;
        }
        // The row as it was, hung where the new text hangs it. Not a merge of the two: a field-by-field
        // copy is how a normalisation the printer papers over gets written back into the document.
        blocks[id] = { ...previous, parentId: fresh.parentId, childrenIds: fresh.childrenIds };
    }

    return { ok: true, rootBlockIds, blocks, touchedBlockIds };
}

// --- Reuse --------------------------------------------------------------------------------------

/**
 * Whether the row that wrote this line may come back unchanged.
 *
 * Matching the line is most of the answer but not all of it, because a line does not mean the same
 * thing everywhere. Two things can still make the old row wrong:
 *
 * - **Its context changed.** Under a `menu` every child is one of its options, so a line moved into or
 *   out of one says something else than it did, whatever it still reads like.
 * - **Something it points at is gone.** A row referring to the row that created a stage object, or to
 *   the row a variable is declared on, holds that row's id. If the author edited that other row it has
 *   a new id, and the old payload now points at nothing - so this row takes the parse's payload, which
 *   resolved the same name against the text that is really there. Its own id is kept either way, which
 *   is what stops one edit from cascading into every row that mentions the same name.
 */
function reusable(
    previous: StoryBlock,
    fresh: StoryBlock,
    scene: StoryScene,
    blocks: Record<StoryBlockId, StoryBlock>,
    oldIds: ReadonlySet<string>,
    present: ReadonlySet<string>,
): boolean {
    if (underChoice(previous, scene.blocks) !== underChoice(fresh, blocks)) {
        return false;
    }
    return !referencesMissingRow(previous.payload, oldIds, present);
}

function underChoice(block: StoryBlock, blocks: Record<StoryBlockId, StoryBlock>): boolean {
    const parent = block.parentId === null ? undefined : blocks[block.parentId];
    return parent !== undefined && (parent.payload as { action?: string }).action === "choice";
}

function referencesMissingRow(value: unknown, oldIds: ReadonlySet<string>, present: ReadonlySet<string>): boolean {
    if (typeof value === "string") {
        return oldIds.has(value) && !present.has(value);
    }
    if (Array.isArray(value)) {
        return value.some((entry) => referencesMissingRow(entry, oldIds, present));
    }
    if (value !== null && typeof value === "object") {
        return Object.values(value).some((entry) => referencesMissingRow(entry, oldIds, present));
    }
    return false;
}

/**
 * Give the condition containers their old ids back.
 *
 * A `condition` container writes no line - the script states it by writing the branches - so the line
 * matching cannot see it, and a fresh parse mints a new one every time. Left alone, every scene with an
 * `if` in it would report a changed container on every save, and a row elsewhere holding that
 * container's id would be pointing at a row that no longer exists.
 *
 * A container is recognised through the rows under it: take the first row inside it that survived the
 * edit, count how many containers stand between that row and this one, and the old container is the one
 * standing at the same count above the same row. Counting is what keeps nested chains apart - the
 * innermost `if` around a row is not the one three levels up - and it survives an edit to the `if` line
 * itself, which the branch rows alone would not. One claim each, so two chains cannot take the same
 * container.
 */
function reclaimContainers(
    scene: StoryScene,
    blocks: Record<StoryBlockId, StoryBlock>,
    rootBlockIds: StoryBlockId[],
    matchedOldIds: ReadonlySet<StoryBlockId>,
): void {
    const claimed = new Set<StoryBlockId>();
    // Outermost first, so a chain nested inside another one asks about a tree the outer pass has
    // already settled.
    for (const id of documentOrder(rootBlockIds, blocks)) {
        const block = blocks[id];
        if (block === undefined || !isConditionContainer(block) || scene.blocks[id] !== undefined) {
            continue;
        }
        const anchor = documentOrder(block.childrenIds, blocks).find((childId) => matchedOldIds.has(childId));
        const level = anchor === undefined ? null : containerDepth(blocks, anchor, id);
        const previous = level === null ? null : containerAbove(scene.blocks, anchor as StoryBlockId, level);
        if (previous === null || claimed.has(previous)) {
            continue;
        }
        claimed.add(previous);
        renameBlock(blocks, rootBlockIds, id, previous);
    }
}

/** How many containers lie between a row and one of its ancestors, that ancestor included. */
function containerDepth(
    blocks: Record<StoryBlockId, StoryBlock>,
    from: StoryBlockId,
    target: StoryBlockId,
): number | null {
    let count = 0;
    let current: StoryBlockId | null = blocks[from]?.parentId ?? null;
    while (current !== null) {
        const block: StoryBlock | undefined = blocks[current];
        if (block === undefined) {
            return null;
        }
        if (isConditionContainer(block)) {
            count += 1;
            if (current === target) {
                return count;
            }
        }
        current = block.parentId;
    }
    return null;
}

/** The `level`-th container above a row, counting from the one nearest it. */
function containerAbove(
    blocks: Record<StoryBlockId, StoryBlock>,
    from: StoryBlockId,
    level: number,
): StoryBlockId | null {
    let count = 0;
    let current: StoryBlockId | null = blocks[from]?.parentId ?? null;
    while (current !== null) {
        const block: StoryBlock | undefined = blocks[current];
        if (block === undefined) {
            return null;
        }
        if (isConditionContainer(block)) {
            count += 1;
            if (count === level) {
                return current;
            }
        }
        current = block.parentId;
    }
    return null;
}

function isConditionContainer(block: StoryBlock): boolean {
    return block.kind === "control" && (block.payload as { control?: string }).control === "condition";
}

/** Move a row to another id, taking every reference to it along - parent, children and the roots. */
function renameBlock(
    blocks: Record<StoryBlockId, StoryBlock>,
    rootBlockIds: StoryBlockId[],
    from: StoryBlockId,
    to: StoryBlockId,
): void {
    const block = blocks[from];
    if (block === undefined || blocks[to] !== undefined) {
        return;
    }
    delete blocks[from];
    blocks[to] = { ...block, id: to };
    for (const childId of block.childrenIds) {
        const child = blocks[childId];
        if (child !== undefined) {
            blocks[childId] = { ...child, parentId: to };
        }
    }
    const parent = block.parentId === null ? undefined : blocks[block.parentId];
    if (parent !== undefined) {
        blocks[parent.id] = { ...parent, childrenIds: parent.childrenIds.map((id) => (id === from ? to : id)) };
    }
    const rootIndex = rootBlockIds.indexOf(from);
    if (rootIndex >= 0) {
        rootBlockIds[rootIndex] = to;
    }
}

function documentOrder(rootBlockIds: readonly StoryBlockId[], blocks: Record<StoryBlockId, StoryBlock>): StoryBlockId[] {
    const out: StoryBlockId[] = [];
    const walk = (ids: readonly StoryBlockId[]): void => {
        for (const id of ids) {
            const block = blocks[id];
            if (block === undefined) {
                continue;
            }
            out.push(id);
            walk(block.childrenIds);
        }
    };
    walk(rootBlockIds);
    return out;
}

// --- Line matching ------------------------------------------------------------------------------

/**
 * How much of a longest-common-subsequence table is worth filling.
 *
 * Beyond this the pass is skipped and every unmatched line falls through to the content pass below,
 * which is weaker (it can pair two identical lines that were never the same row) but linear. A scene
 * large enough to hit this has thousands of rows.
 */
const LCS_CELL_LIMIT = 4_000_000;

/**
 * Which old line each new line came from, as `[newIndex, oldIndex]`.
 *
 * Three passes, in falling order of confidence. The common prefix and suffix are the lines an edit did
 * not reach, and they cost nothing to find. A longest common subsequence pairs the rest in order, which
 * is what keeps a row's identity when the row above it was deleted. What survives both is matched by
 * content alone, in order: that is the pass that recovers a MOVE, because a passage dragged elsewhere
 * appears as a deletion here and an insertion there, and the two halves say the same words.
 *
 * Every pass claims each old line at most once - two new lines cannot both be the same row.
 */
function matchScriptLines(before: readonly string[], after: readonly string[]): [number, number][] {
    const pairs: [number, number][] = [];
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) {
        pairs.push([head, head]);
        head += 1;
    }
    let tail = 0;
    while (
        before.length - tail - 1 >= head
        && after.length - tail - 1 >= head
        && before[before.length - tail - 1] === after[after.length - tail - 1]
    ) {
        pairs.push([after.length - tail - 1, before.length - tail - 1]);
        tail += 1;
    }

    const oldFrom = head;
    const oldTo = before.length - tail;
    const newFrom = head;
    const newTo = after.length - tail;
    const claimedOld = new Set<number>();
    const claimedNew = new Set<number>();
    if ((oldTo - oldFrom) * (newTo - newFrom) <= LCS_CELL_LIMIT) {
        for (const [newIndex, oldIndex] of commonSubsequence(before, after, oldFrom, oldTo, newFrom, newTo)) {
            pairs.push([newIndex, oldIndex]);
            claimedOld.add(oldIndex);
            claimedNew.add(newIndex);
        }
    }

    const spare = new Map<string, number[]>();
    for (let index = oldFrom; index < oldTo; index += 1) {
        if (!claimedOld.has(index)) {
            const queue = spare.get(before[index]);
            if (queue === undefined) {
                spare.set(before[index], [index]);
            } else {
                queue.push(index);
            }
        }
    }
    for (let index = newFrom; index < newTo; index += 1) {
        if (claimedNew.has(index)) {
            continue;
        }
        const queue = spare.get(after[index]);
        const oldIndex = queue?.shift();
        if (oldIndex !== undefined) {
            pairs.push([index, oldIndex]);
        }
    }
    return pairs;
}

/** The classic table, walked once forwards to fill it and once backwards to read the pairs out. */
function commonSubsequence(
    before: readonly string[],
    after: readonly string[],
    oldFrom: number,
    oldTo: number,
    newFrom: number,
    newTo: number,
): [number, number][] {
    const rows = oldTo - oldFrom;
    const columns = newTo - newFrom;
    if (rows <= 0 || columns <= 0) {
        return [];
    }
    const width = columns + 1;
    const table = new Int32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i -= 1) {
        for (let j = columns - 1; j >= 0; j -= 1) {
            table[i * width + j] = before[oldFrom + i] === after[newFrom + j]
                ? table[(i + 1) * width + j + 1] + 1
                : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        }
    }
    const pairs: [number, number][] = [];
    let i = 0;
    let j = 0;
    while (i < rows && j < columns) {
        if (before[oldFrom + i] === after[newFrom + j]) {
            pairs.push([newFrom + j, oldFrom + i]);
            i += 1;
            j += 1;
        } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
            i += 1;
        } else {
            j += 1;
        }
    }
    return pairs;
}
