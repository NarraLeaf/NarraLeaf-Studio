import type {StoryBlock, StoryDocument, StoryScene} from "@shared/types/story/document";
import {listSceneIdsInDocumentOrder} from "@shared/types/story/order";
import type {
    DocumentChangeLabel,
    DocumentMerge3,
    DocumentMergeDecision,
    DocumentMergeSide,
} from "../diff";
import {authoredName, sameJsonValue} from "./diffHelpers";
import {countConflicts, KeyedMergeRow, mergeKeyed} from "./mergeHelpers";

/**
 * Three-way merge of one story - and, as much as anything, the cases it declines to merge.
 *
 * Everything that works here rests on the same fact the semantic diff rests on: **scenes and blocks
 * are keyed by id**, so "the same thing on both sides" is already written down and matching is exact
 * and free. Plan 2026-07-31-004 §4.3 spells the rules out and they fall out of that one property:
 * different scenes merge, the same scene's different rows merge, the same row's different fields
 * merge, and the same field on both sides is a leaf conflict.
 *
 * Two rules do NOT fall out of it, and both are decisions rather than mechanics:
 *
 *  - **An ordered array the author arranged is atomic.** Changed on one side, take that side;
 *    changed on both, ONE decision for the whole array. Never interleaved. This is the opposite of
 *    what the asset shard does with its key order, and the difference is the point: an asset's
 *    position is recovered import order, a story's is something a person arranged.
 *  - **Both sides rearranging one scene's rows is refused outright**, and the whole document falls
 *    back to being taken from one side. See {@link StoryMergeRefusalReason}.
 *
 * Pure, total, and non-mutating, per the `DocumentSpec.merge3` contract - it runs in the main
 * process, where one throw takes out the entire change list. Every field is read defensively:
 * `storySpec.parse` does not migrate, so these documents may predate anything named here.
 */

/**
 * Why a story merge declines. Stable identifiers; the surface owns the words.
 *
 *  - `scene-restructured` - **the headline refusal.** Both sides rearranged the same scene's rows
 *    and did not arrive at the same arrangement. There is no third arrangement that is either of
 *    theirs, and inventing one produces a scene nobody wrote which still compiles.
 *  - `row-deleted-and-edited` - one side removed a row the other side edited. Plan §4.5 item 5 at
 *    row granularity. It cannot be answered by holding base the way every other conflict is, because
 *    the surviving side's `rootBlockIds` no longer names that row: the held row would sit in
 *    `blocks` unreferenced, i.e. present in the file and invisible in the editor.
 *  - `schema-version-split` - the two sides are at different story schema versions. Merging them by
 *    id yields a document whose rows are half one schema and half another, stamped with one version
 *    number, and nothing downstream would ever be told. The older side migrates on open; taking one
 *    side whole is the only answer that keeps a document self-consistent.
 */
export type StoryMergeRefusalReason =
    | "scene-restructured"
    | "row-deleted-and-edited"
    | "schema-version-split";

/**
 * Labels reused verbatim from the semantic diff (`storyDiff.ts`), and reused rather than invented
 * because a decision and a change are the same row seen twice - plan §0 - so they must read the
 * same. Every key here is already in both catalogues; `documentDiffKeys.test.ts` is what enforces
 * that, and a new key would have to be added to en and zh in the same commit.
 */
const LABEL = {
    renamed: "documentDiff.story.renamed",
    documentField: "documentDiff.story.documentField",
    chapterOrder: "documentDiff.story.chapterOrder",
    sceneAdded: "documentDiff.story.sceneAdded",
    sceneRemoved: "documentDiff.story.sceneRemoved",
    sceneChanged: "documentDiff.story.sceneChanged",
    sceneRenamed: "documentDiff.story.sceneRenamed",
    sceneField: "documentDiff.story.sceneField",
    blockAdded: "documentDiff.story.blockAdded",
    blockRemoved: "documentDiff.story.blockRemoved",
    blockChanged: "documentDiff.story.blockChanged",
    blockKind: "documentDiff.story.blockKind",
    blockField: "documentDiff.story.blockField",
} as const;

/** Handled explicitly below, so they never reach the generic document-field merge. */
const DOCUMENT_SKIP = new Set(["scenes", "schemaVersion", "id"]);
/** `blocks` and `rootBlockIds` are the scene's structure; `id` is its key. */
const SCENE_SKIP = new Set(["blocks", "rootBlockIds", "id"]);
/** `parentId` / `childrenIds` are structure and are stamped from it; `id` is the key. */
const BLOCK_SKIP = new Set(["id", "parentId", "childrenIds"]);

type Fields = Record<string, unknown>;

export function merge3Story(
    base: StoryDocument | undefined,
    mine: StoryDocument,
    theirs: StoryDocument,
): DocumentMerge3<StoryDocument> {
    if (isVersion(mine.schemaVersion) && isVersion(theirs.schemaVersion)
        && mine.schemaVersion !== theirs.schemaVersion) {
        return refuse("schema-version-split", base, mine, theirs);
    }

    const decisions: DocumentMergeDecision[] = [];
    const fields = mergeKeyed(
        // `undefined` rather than `{}` when there is no base, and the two are NOT the same argument:
        // an empty base makes a field only one side holds look like a field the other side deleted
        // and nobody touched, which `mergeKeyed` then takes automatically. That is the add/add
        // failure its own note is about, one level up from the collection it was written for.
        base ? stripFields(base, DOCUMENT_SKIP) : undefined,
        stripFields(mine, DOCUMENT_SKIP),
        stripFields(theirs, DOCUMENT_SKIP),
    );
    for (const row of byKey(fields.rows)) {
        decisions.push(build([row.key], row, documentFieldLabel(row)));
    }

    const baseScenes = scenesOf(base);
    const mineScenes = scenesOf(mine);
    const theirsScenes = scenesOf(theirs);
    const scenesMerge = mergeKeyed<StoryScene>(base ? baseScenes : undefined, mineScenes, theirsScenes);
    const scenes: Record<string, StoryScene> = {...scenesMerge.merged};

    // Ordered the way the author reads the story - mine's order, then whatever only theirs has -
    // rather than by the key order of `scenes`, which the canonical serializer sorts by UUID.
    const rank = sceneRank(mine, theirs, base);
    const grouped: {rank: number; rows: DocumentMergeDecision[]}[] = [];

    for (const row of scenesMerge.rows) {
        const scenePath = ["scenes", row.key];
        const at = rank.get(row.key) ?? Number.MAX_SAFE_INTEGER;
        const inBase = base ? baseScenes[row.key] : undefined;
        const inMine = mineScenes[row.key];
        const inTheirs = theirsScenes[row.key];

        // Both sides changed a scene that existed before. The only case worth going inside, and the
        // only case a refusal can come out of.
        if (row.outcome === "conflict" && inBase && inMine && inTheirs) {
            const merged = mergeScene(row.key, inBase, inMine, inTheirs);
            if ("refused" in merged) {
                return refuse(merged.refused, base, mine, theirs, scenePath, authoredName(inMine.name));
            }
            scenes[row.key] = merged.scene;
            grouped.push({rank: at, rows: merged.decisions});
            continue;
        }

        grouped.push({rank: at, rows: [build(scenePath, row, sceneLabel(row), sceneSubject(row))]});
    }

    grouped.sort((a, b) => a.rank - b.rank);
    for (const entry of grouped) {
        decisions.push(...entry.rows);
    }

    const document = {
        ...fields.merged,
        ...(mine.schemaVersion === undefined ? {} : {schemaVersion: mine.schemaVersion}),
        ...(mine.id === undefined ? {} : {id: mine.id}),
        scenes,
    } as unknown as StoryDocument;

    return {document, decisions, conflicts: countConflicts(decisions)};
}

/** The whole-document answer: hold base, offer the two sides, and say why. */
function refuse(
    reason: StoryMergeRefusalReason,
    base: StoryDocument | undefined,
    mine: StoryDocument,
    theirs: StoryDocument,
    path?: readonly string[],
    subject?: string,
): DocumentMerge3<StoryDocument> {
    return {
        // Base, on the same terms as any other unsettled conflict; mine when there is none.
        document: base ?? mine,
        // One decision, addressed at the document itself. A consumer that never reads `refusal`
        // still cannot merge this by accident - it is handed exactly tier one's "take one side
        // whole", which is the designed fallback rather than a degraded one.
        decisions: [{
            path: [],
            outcome: "conflict",
            // No label on purpose: there is no `documentDiff.*` key for "this cannot be merged", and
            // emitting one that is in neither catalogue would draw the dotted path itself at the
            // author. The reason below is what the surface renders, in its own words.
            ...(subject ? {subject} : {}),
            mine: {present: true, value: mine},
            theirs: {present: true, value: theirs},
        }],
        conflicts: 1,
        refusal: {reason, ...(path ? {path} : {}), ...(subject ? {subject} : {})},
    };
}

// --- scenes ---------------------------------------------------------------------------------

type SceneMerge =
    | {readonly refused: StoryMergeRefusalReason}
    | {readonly scene: StoryScene; readonly decisions: DocumentMergeDecision[]};

/**
 * A scene's shape, as the thing two sides either agree about or do not.
 *
 * `roots` plus every block's `childrenIds` IS the tree; `parents` is the back-pointer that has to
 * agree with it, and including it is what makes a re-parent count. The block ids are in here
 * implicitly, as the keys - which is deliberate: adding or deleting a row changes the shape of the
 * scene exactly as much as moving one does, and every one of those changes lands in an ordered array
 * that cannot be interleaved.
 */
interface SceneStructure {
    readonly roots: readonly unknown[];
    readonly children: Fields;
    readonly parents: Fields;
}

function structureOf(scene: StoryScene | undefined): SceneStructure {
    const blocks = blocksOf(scene);
    const children: Fields = {};
    const parents: Fields = {};
    for (const id of Object.keys(blocks).sort()) {
        const block = blocks[id] as StoryBlock | undefined;
        children[id] = Array.isArray(block?.childrenIds) ? block?.childrenIds : [];
        parents[id] = block?.parentId ?? null;
    }
    return {roots: Array.isArray(scene?.rootBlockIds) ? scene?.rootBlockIds ?? [] : [], children, parents};
}

/**
 * One scene both sides changed: merge inside it, or refuse the whole document.
 *
 * Three shapes go in and there are exactly three outcomes, in this order:
 *
 *  1. **The two sides agree about the scene's shape** (including both leaving it alone, and both
 *     making the same rearrangement). Then the block id sets are identical by construction, nothing
 *     can be orphaned, and everything merges row by row and field by field.
 *  2. **Both sides changed the shape, differently.** Refused - the case this milestone is about.
 *  3. **Exactly one side changed the shape.** That side owns it: only one of them rearranged, so
 *     there was a right answer and it is taken, exactly as any other `auto-*` is. The other side's
 *     row edits still merge on top, which is what keeps tier two useful for the commonest
 *     collaboration there is - one person writing rows while another fixes a line.
 *
 * The one thing 3 cannot absorb is the other side having edited a row the owner deleted, which is
 * refused rather than settled: holding base for it - what every other conflict does - would put a
 * row in `blocks` that no ordered array names, and an invisible row in a file is the same
 * silent-and-late failure the whole refusal exists to prevent.
 */
function mergeScene(sceneId: string, base: StoryScene, mine: StoryScene, theirs: StoryScene): SceneMerge {
    const baseShape = structureOf(base);
    const mineShape = structureOf(mine);
    const theirsShape = structureOf(theirs);
    let shape = mine;

    if (!sameJsonValue(mineShape, theirsShape)) {
        const mineMoved = !sameJsonValue(mineShape, baseShape);
        const theirsMoved = !sameJsonValue(theirsShape, baseShape);
        if (mineMoved && theirsMoved) {
            return {refused: "scene-restructured"};
        }
        shape = mineMoved ? mine : theirs;
        const other = mineMoved ? theirs : mine;
        const baseBlocks = blocksOf(base);
        const shapeBlocks = blocksOf(shape);
        const otherBlocks = blocksOf(other);
        for (const id of Object.keys(baseBlocks)) {
            if (Object.prototype.hasOwnProperty.call(shapeBlocks, id)) {
                continue;
            }
            if (!sameJsonValue(baseBlocks[id], otherBlocks[id])) {
                return {refused: "row-deleted-and-edited"};
            }
        }
    }

    const decisions: DocumentMergeDecision[] = [];
    const fields = mergeKeyed(
        stripFields(base, SCENE_SKIP),
        stripFields(mine, SCENE_SKIP),
        stripFields(theirs, SCENE_SKIP),
    );
    for (const row of byKey(fields.rows)) {
        decisions.push(build(["scenes", sceneId, row.key], row, sceneFieldLabel(row)));
    }

    const blocks = mergeKeyed<StoryBlock>(blocksOf(base), blocksOf(mine), blocksOf(theirs));
    const settled: Record<string, StoryBlock | undefined> = {...blocks.merged};
    for (const row of blocks.rows) {
        const path = ["scenes", sceneId, "blocks", row.key];
        // Attempted for every row a block survives on both sides of, not only for the contested
        // ones: a row one side edited is addressed at `…/payload` by the semantic diff, and a
        // decision that named the whole block instead would break the one premise the tier rests
        // on - that a comparison and a resolution are one list seen twice, addressed alike.
        const refined = refineBlock(path, blocksOf(base)[row.key], blocksOf(mine)[row.key], blocksOf(theirs)[row.key]);
        if (refined) {
            settled[row.key] = refined.block;
            decisions.push(...refined.decisions);
            continue;
        }
        decisions.push(build(path, row, blockLabel(row)));
    }

    // Built from the SHAPE rather than from the merged map, so a row can only be in the scene if the
    // scene's own ordering names it. Nothing here can produce an orphan even if the reasoning above
    // has a hole in it.
    const shapeBlocks = blocksOf(shape);
    const merged: Record<string, StoryBlock> = {};
    for (const id of Object.keys(structureOf(shape).children)) {
        const chosen = settled[id] ?? shapeBlocks[id];
        if (chosen) {
            merged[id] = withShape(chosen, shapeBlocks[id]);
        }
    }

    const scene = {
        ...fields.merged,
        ...(sceneId === undefined ? {} : {id: sceneId}),
        rootBlockIds: Array.isArray(shape.rootBlockIds) ? shape.rootBlockIds : [],
        blocks: merged,
    } as unknown as StoryScene;

    return {scene, decisions};
}

/** A block wearing the scene's structure, whichever side its contents came from. */
function withShape(block: StoryBlock, shape: StoryBlock | undefined): StoryBlock {
    if (!shape) {
        return block;
    }
    const next = {...(block as unknown as Fields)};
    for (const field of ["parentId", "childrenIds"]) {
        if (Object.prototype.hasOwnProperty.call(shape, field)) {
            next[field] = (shape as unknown as Fields)[field];
        } else {
            delete next[field];
        }
    }
    return next as unknown as StoryBlock;
}

/**
 * One row both sides edited, taken apart field by field - or not taken apart at all.
 *
 * **`kind` and `payload` move together and are never split.** They are a discriminated pair: a
 * record built from one side's `kind` and the other's `payload` describes a row of a type whose
 * parameters belong to a different type, which is not a compromise between the two edits but a row
 * neither author wrote. So a block whose `kind` differs anywhere is left as one whole-block decision
 * and this returns nothing. When `kind` agrees, `payload` is compared whole (descending into it
 * would need a merge that knows what every action's parameters mean) and `disabled` /
 * `diagnosticsMeta` merge beside it independently - which is the "same block, different fields"
 * case plan §4.3 asks for: I disabled the row, you fixed its text, both land.
 */
function refineBlock(
    path: readonly string[],
    base: StoryBlock | undefined,
    mine: StoryBlock | undefined,
    theirs: StoryBlock | undefined,
): {block: StoryBlock; decisions: DocumentMergeDecision[]} | undefined {
    if (!base || !mine || !theirs) {
        return undefined;
    }
    if (!sameJsonValue(base.kind, mine.kind) || !sameJsonValue(base.kind, theirs.kind)) {
        return undefined;
    }

    const fields = mergeKeyed(
        stripFields(base, BLOCK_SKIP),
        stripFields(mine, BLOCK_SKIP),
        stripFields(theirs, BLOCK_SKIP),
    );
    const decisions = byKey(fields.rows).map(row => build([...path, row.key], row, blockFieldLabel(row)));
    const block = {
        ...fields.merged,
        ...(base.id === undefined ? {} : {id: base.id}),
    } as unknown as StoryBlock;
    return {block, decisions};
}

// --- labels ---------------------------------------------------------------------------------

function label(key: string, params?: Record<string, string | number>): DocumentChangeLabel {
    return params && Object.keys(params).length > 0 ? {key, params} : {key};
}

function documentFieldLabel(row: KeyedMergeRow<unknown>): DocumentChangeLabel {
    if (row.key === "name") {
        return label(LABEL.renamed);
    }
    // The chapter list is one ordered array and gets one row, whatever moved inside it. Worded as a
    // reorder only when it really is one - the same ids in a different sequence.
    if (row.key === "chapters" && sameIds(row.mine.value, row.theirs.value)) {
        return label(LABEL.chapterOrder);
    }
    return label(LABEL.documentField, {field: row.key});
}

function sceneFieldLabel(row: KeyedMergeRow<unknown>): DocumentChangeLabel {
    return row.key === "name" ? label(LABEL.sceneRenamed) : label(LABEL.sceneField, {field: row.key});
}

function blockFieldLabel(row: KeyedMergeRow<unknown>): DocumentChangeLabel {
    // `payload` is the row itself. `disabled` deliberately does NOT use the diff's
    // `blockDisabled`/`blockEnabled` pair: those name an outcome, and this row is the question.
    return row.key === "payload" ? label(LABEL.blockChanged) : label(LABEL.blockField, {field: row.key});
}

function sceneLabel(row: KeyedMergeRow<StoryScene>): DocumentChangeLabel {
    if (!row.base.present) {
        return label(LABEL.sceneAdded, {blocks: blockCount(row)});
    }
    if (!row.mine.present || !row.theirs.present) {
        return label(LABEL.sceneRemoved, {blocks: blockCount(row)});
    }
    return label(LABEL.sceneChanged);
}

function blockLabel(row: KeyedMergeRow<StoryBlock>): DocumentChangeLabel {
    if (!row.base.present) {
        return label(LABEL.blockAdded);
    }
    if (!row.mine.present || !row.theirs.present) {
        return label(LABEL.blockRemoved);
    }
    const mineKind = (row.mine.value as StoryBlock | undefined)?.kind;
    const theirsKind = (row.theirs.value as StoryBlock | undefined)?.kind;
    return sameJsonValue(mineKind, theirsKind) ? label(LABEL.blockChanged) : label(LABEL.blockKind);
}

/** The scene's own name, from whichever side still has it. Never a generated id - see `authoredName`. */
function sceneSubject(row: KeyedMergeRow<StoryScene>): string | undefined {
    const present = (row.mine.present ? row.mine.value : undefined) ?? row.theirs.value ?? row.base.value;
    return authoredName((present as StoryScene | undefined)?.name);
}

function blockCount(row: KeyedMergeRow<StoryScene>): number {
    const present = (row.mine.present ? row.mine.value : undefined) ?? row.theirs.value ?? row.base.value;
    const blocks = (present as StoryScene | undefined)?.blocks;
    return blocks && typeof blocks === "object" ? Object.keys(blocks).length : 0;
}

// --- plumbing -------------------------------------------------------------------------------

/**
 * Field rows in key order, so the same pair of documents produces the same list every run.
 *
 * `mergeKeyed` keeps mine's key order, which is right for a collection whose insertion order is
 * data and wrong for the fields of a record: those arrive in whatever order the object was built
 * in, so an editor's document and a freshly parsed one would list the same two decisions in
 * different orders. The keyed collections above are NOT sorted here - their order is the author's
 * reading order, which `sceneRank` and the scene's own arrays already state.
 */
function byKey<V>(rows: readonly KeyedMergeRow<V>[]): KeyedMergeRow<V>[] {
    return [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function build(
    path: readonly string[],
    row: {outcome: DocumentMergeDecision["outcome"]; mine: DocumentMergeSide; theirs: DocumentMergeSide},
    labelled: DocumentChangeLabel,
    subject?: string,
): DocumentMergeDecision {
    return {
        path,
        outcome: row.outcome,
        label: labelled,
        ...(subject ? {subject} : {}),
        mine: row.mine,
        theirs: row.theirs,
    };
}

/**
 * A record's own fields, minus the ones handled elsewhere and minus any explicit `undefined`.
 *
 * The `undefined` filter is not defensive tidying: an own key holding `undefined` cannot come out of
 * `JSON.parse` but can come out of an in-memory document, `mergeKeyed` counts it as present, and the
 * canonical encoder refuses to write it - so it would turn a merge into a document that cannot be
 * saved, at the very end of the pipeline.
 */
function stripFields(record: unknown, skip: ReadonlySet<string>): Fields {
    const out: Fields = {};
    if (!record || typeof record !== "object") {
        return out;
    }
    for (const [key, value] of Object.entries(record as Fields)) {
        if (skip.has(key) || value === undefined) {
            continue;
        }
        out[key] = value;
    }
    return out;
}

function scenesOf(document: StoryDocument | undefined): Record<string, StoryScene> {
    const scenes = document?.scenes;
    return scenes && typeof scenes === "object" ? scenes as Record<string, StoryScene> : {};
}

function blocksOf(scene: StoryScene | undefined): Record<string, StoryBlock> {
    const blocks = scene?.blocks;
    return blocks && typeof blocks === "object" ? blocks as Record<string, StoryBlock> : {};
}

function isVersion(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/** Whether two id-carrying arrays hold the same ids, i.e. whether a change to one is a reorder. */
function sameIds(left: unknown, right: unknown): boolean {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
    }
    const ids = (list: unknown[]): string[] =>
        list.map(one => String((one as {id?: unknown} | null)?.id ?? "")).sort();
    return sameJsonValue(ids(left), ids(right));
}

/** Reading order: mine's, then whatever only theirs or only base still holds. */
function sceneRank(
    mine: StoryDocument,
    theirs: StoryDocument,
    base: StoryDocument | undefined,
): Map<string, number> {
    const rank = new Map<string, number>();
    for (const document of [mine, theirs, ...(base ? [base] : [])]) {
        for (const sceneId of orderedSceneIds(document)) {
            if (!rank.has(sceneId)) {
                rank.set(sceneId, rank.size);
            }
        }
    }
    return rank;
}

function orderedSceneIds(document: StoryDocument): string[] {
    if (!document.scenes || typeof document.scenes !== "object") {
        return [];
    }
    try {
        return listSceneIdsInDocumentOrder(document);
    } catch {
        // These documents came out of a repository and were not migrated, so a helper that indexes a
        // field this one predates must not be able to take the merge down with it.
        return [];
    }
}
