import type { DocumentChange } from "@shared/documents/diff";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";
import { listSceneIdsInDocumentOrder } from "@shared/types/story/order";
import type { DocumentChangeRow } from "../documentChangeView";
import { changeMaskTone, maskColumns, type ChangeMaskTone } from "../presenters/changeMask";

/**
 * A story's two versions as one script, worked out before anything is drawn.
 *
 * The comparison's halves used to draw a story as the same list of change rows the narrow detail
 * column draws - "row changed", "row changed", "row added" - which names what happened and never
 * says the line. A story is read as script, so each half draws the scene's blocks the way the story
 * editor lays them out, at the version that half is showing, with the changed blocks marked.
 *
 * Everything here is arithmetic over two documents plus a change list, and every one of these
 * decisions is a way the surface could lie quietly, so none of them is made inside a component:
 * which blocks the two versions share, where a block only one version holds belongs in the other,
 * which mark a line wears, and which changes the script cannot show at all.
 *
 * # The unit is a block, and it stays a block
 *
 * `storyDiff.ts` compares a block's whole `payload` in one go - descending into it would mean a diff
 * that knows what every action's parameters mean - so what the data supports is "this line changed"
 * and never "these words in this line changed". Whole lines are marked here and nothing finer is
 * offered, because a word-level highlight drawn from a whole-payload comparison would be invented.
 *
 * # Every change is placed or is drawn as a row
 *
 * A story's changes are not all about a line: the document's own name, a chapter's scene list, a
 * scene's background. Those cannot be marked on a script, so they keep the change row the list
 * already draws for them, ahead of the script. Nothing is dropped - the count previous and next
 * walk is the same count it was before this surface drew anything.
 *
 * # Only the scenes that changed
 *
 * A project's story is longer than a comparison, and forty unchanged scenes of script between two
 * edits is a wall to scroll rather than an answer. A scene appears when a change lands in it, and
 * then it appears whole, because the line before and the line after are what make a changed line
 * readable.
 */

/** One block as one version reads it. Each half draws its own, so nothing here is shared. */
export interface StoryScriptLine {
    readonly blockId: StoryBlockId;
    readonly block: StoryBlock;
    /** Nesting under containers, as the scene reads it in THIS version. */
    readonly depth: number;
    /** Position in its scene in THIS version, from 1 - the number the story editor prints. */
    readonly lineNumber: number;
}

/** A scene's heading as one version reads it. */
export interface StoryScriptScene {
    /** The author's own name for the scene, or null where they have not given it one. */
    readonly name: string | null;
}

/**
 * One row of the comparison, present in one half, the other, or both.
 *
 * The three kinds are one array rather than three lists because the halves scroll together: a slot
 * is a height both halves reserve, and a slot missing from one of them is what the shell draws as a
 * hatched gap. Order here IS order on screen, in both halves.
 */
export type StoryScriptSlot =
    | {
        readonly kind: "change";
        readonly key: string;
        /** The change row this slot draws, exactly as the detail column draws it. */
        readonly row: DocumentChangeRow;
        readonly onBase: boolean;
        readonly onHead: boolean;
        readonly tone: ChangeMaskTone | null;
        readonly stop: boolean;
    }
    | {
        readonly kind: "scene";
        readonly key: string;
        readonly sceneId: StorySceneId;
        readonly base: StoryScriptScene | null;
        readonly head: StoryScriptScene | null;
        readonly onBase: boolean;
        readonly onHead: boolean;
        readonly tone: ChangeMaskTone | null;
        readonly stop: boolean;
    }
    | {
        readonly kind: "block";
        readonly key: string;
        readonly sceneId: StorySceneId;
        readonly base: StoryScriptLine | null;
        readonly head: StoryScriptLine | null;
        readonly onBase: boolean;
        readonly onHead: boolean;
        readonly tone: ChangeMaskTone | null;
        readonly stop: boolean;
    };

export interface StoryScriptPlan {
    readonly slots: readonly StoryScriptSlot[];
    /** Blocks drawn, counted once however many versions hold them. What the ceiling is measured on. */
    readonly blocks: number;
}

/**
 * How many block rows one comparison may draw.
 *
 * The list is not virtualised and both halves render every slot, and the shell re-measures every
 * slot after every render - so this number is doubled before it reaches the DOM and paid for again
 * on each pass. 800 is two 800-row columns, which is already a longer scene than anyone writes in
 * one, and past it the caller falls back to the change list: a few rows that say the same true
 * things. Nothing here decides what to say about that, because there is nothing new to say - see
 * `useStoryScript`, where the fallback is taken.
 */
export const STORY_SCRIPT_BLOCK_CEILING = 800;

/** Strength order, so a line that both moved and changed wears the mark that says more. */
const TONE_RANK: Record<ChangeMaskTone, number> = { moved: 0, changed: 1, added: 2, removed: 3 };

/**
 * The script both halves draw, from the two documents and the rows the change list would have shown.
 *
 * @param rows the change list's own rows - the same ones, in the same order, so a change reachable
 *  by previous and next before this surface existed is still reachable now.
 * @param base the story at the older version, or null where that version does not hold it.
 * @param head the story at the newer version, or null.
 */
export function buildStoryScriptPlan(
    rows: readonly DocumentChangeRow[],
    base: StoryDocument | null,
    head: StoryDocument | null,
): StoryScriptPlan {
    const placement = placeRows(rows);

    const slots: StoryScriptSlot[] = [];
    for (const row of placement.unplaced) {
        const columns = maskColumns(row.change.kind);
        slots.push({
            kind: "change",
            key: `change:${row.key}`,
            row,
            onBase: columns.onBase,
            onHead: columns.onHead,
            tone: changeMaskTone(row.change),
            stop: true,
        });
    }

    let blocks = 0;
    for (const sceneId of mergeOrder(orderedScenes(base), orderedScenes(head))) {
        if (!placement.scenes.has(sceneId)) {
            continue;
        }
        const baseScene = base?.scenes?.[sceneId] ?? null;
        const headScene = head?.scenes?.[sceneId] ?? null;
        slots.push({
            kind: "scene",
            key: `scene:${sceneId}`,
            sceneId,
            base: baseScene ? { name: baseScene.name || null } : null,
            head: headScene ? { name: headScene.name || null } : null,
            // Presence, not the change kind: a scene one version does not hold is the hatched gap in
            // that half, which is what keeps the two columns facing each other's counterparts.
            onBase: baseScene !== null,
            onHead: headScene !== null,
            tone: placement.tones.get(`scene:${sceneId}`) ?? null,
            stop: placement.stops.has(`scene:${sceneId}`),
        });

        const baseLines = scriptLines(baseScene);
        const headLines = scriptLines(headScene);
        for (const blockId of mergeOrder([...baseLines.keys()], [...headLines.keys()])) {
            const key = `block:${sceneId}/${blockId}`;
            const base = baseLines.get(blockId) ?? null;
            const head = headLines.get(blockId) ?? null;
            blocks += 1;
            slots.push({
                kind: "block",
                key,
                sceneId,
                base,
                head,
                onBase: base !== null,
                onHead: head !== null,
                tone: placement.tones.get(key) ?? null,
                stop: placement.stops.has(key),
            });
        }
    }

    return { slots, blocks };
}

interface RowPlacement {
    /** Rows the script has no line for, in their original order. */
    readonly unplaced: readonly DocumentChangeRow[];
    /** Scenes with at least one change in them - the ones worth drawing. */
    readonly scenes: ReadonlySet<StorySceneId>;
    /** Slot key to the mark it wears. */
    readonly tones: ReadonlyMap<string, ChangeMaskTone>;
    /** Slot keys previous and next stop on. */
    readonly stops: ReadonlySet<string>;
}

/**
 * Which slot each change row belongs to, or that it belongs to none.
 *
 * Read from the change's PATH, never from its label: `storyDiff.ts` states its addressing as the
 * contract - a scene is `["scenes", <sceneId>]` and a row inside one is `["scenes", <sceneId>,
 * "blocks", <blockId>, ...]` - and a surface that parsed a display string to find an id would break
 * the first time a label was reworded.
 */
function placeRows(rows: readonly DocumentChangeRow[]): RowPlacement {
    const unplaced: DocumentChangeRow[] = [];
    const scenes = new Set<StorySceneId>();
    const tones = new Map<string, ChangeMaskTone>();
    const stops = new Set<string>();

    for (const row of rows) {
        const key = slotKeyOf(row.change);
        if (!key) {
            unplaced.push(row);
            continue;
        }
        scenes.add(key.sceneId);
        stops.add(key.slot);
        const tone = changeMaskTone(row.change);
        const held = tones.get(key.slot);
        if (held === undefined || TONE_RANK[tone] > TONE_RANK[held]) {
            tones.set(key.slot, tone);
        }
    }

    return { unplaced, scenes, tones, stops };
}

function slotKeyOf(change: DocumentChange): { slot: string; sceneId: StorySceneId } | null {
    const path = change.path;
    if (path[0] !== "scenes" || typeof path[1] !== "string") {
        return null;
    }
    const sceneId = path[1];
    if (path[2] === "blocks" && typeof path[3] === "string") {
        return { slot: `block:${sceneId}/${path[3]}`, sceneId };
    }
    // The scene itself, and every field of it that is not a row: its name, its background, the
    // order of its rows. All of them are facts about the scene, so all of them mark its heading.
    return { slot: `scene:${sceneId}`, sceneId };
}

/** Every scene of a document in authoring order, defensively - these documents came off a shelf. */
function orderedScenes(document: StoryDocument | null): StorySceneId[] {
    if (!document || !document.scenes || typeof document.scenes !== "object") {
        return [];
    }
    try {
        return listSceneIdsInDocumentOrder(document);
    } catch {
        return [];
    }
}

/**
 * A scene's blocks in the order it is read, each with the depth and the number that version prints.
 *
 * The same depth-first walk the compiler runs and the story editor draws, with the same guard
 * against a `childrenIds` cycle: a corrupt document is one Studio still has to be able to open, and
 * a comparison is where an author goes to find out what corrupted it.
 */
function scriptLines(scene: StoryScene | null): Map<StoryBlockId, StoryScriptLine> {
    const lines = new Map<StoryBlockId, StoryScriptLine>();
    if (!scene || !scene.blocks) {
        return lines;
    }
    const visit = (blockId: StoryBlockId, depth: number): void => {
        if (lines.has(blockId)) {
            return;
        }
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        lines.set(blockId, { blockId, block, depth, lineNumber: lines.size + 1 });
        for (const childId of block.childrenIds ?? []) {
            visit(childId, depth + 1);
        }
    };
    for (const rootId of scene.rootBlockIds ?? []) {
        visit(rootId, 0);
    }
    return lines;
}

/**
 * Two orderings of overlapping ids as one, with the newer version leading.
 *
 * An id only the older version holds is emitted **where it was**: directly after the last id before
 * it that both versions hold. Appending those to the end instead - which is all a rank table can do
 * - would put every deleted line in a heap at the bottom of the scene, and the two halves would then
 * face each other's counterparts everywhere except exactly where something was deleted.
 */
export function mergeOrder(base: readonly string[], head: readonly string[]): string[] {
    const inHead = new Set(head);
    const trailing = new Map<string | null, string[]>();
    let anchor: string | null = null;
    for (const id of base) {
        if (inHead.has(id)) {
            anchor = id;
            continue;
        }
        const held = trailing.get(anchor);
        if (held) {
            held.push(id);
        } else {
            trailing.set(anchor, [id]);
        }
    }

    const merged: string[] = [...(trailing.get(null) ?? [])];
    const seen = new Set(merged);
    for (const id of head) {
        if (!seen.has(id)) {
            merged.push(id);
            seen.add(id);
        }
        for (const orphan of trailing.get(id) ?? []) {
            if (!seen.has(orphan)) {
                merged.push(orphan);
                seen.add(orphan);
            }
        }
    }
    return merged;
}
