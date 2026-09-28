import type { DocumentMergeDecision, DocumentMergeSide } from "@shared/documents/diff";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { projectStoryRow, type StoryRowLookups } from "@/lib/story/storyRowProjection";
import { elideGeneratedIdentifiers } from "./identifierDisplay";
import type { MergeSidesView, MergeValueView } from "./mergeDecisionView";

/**
 * A story merge's rows, drawn the way the story editor draws the line they are about.
 *
 * The generic describer lays a side out field by field, and for a row of a script the fields are the
 * storage the row is kept in: an author choosing between two versions of one spoken line read
 * `text.value`, `action dialogue`, `characterId …`, `text.textId …` and "one more", and found the
 * line itself only in the first of them. A row has one reading, and it is the editor's - who speaks,
 * and what is said - so a decision about a row, whole or its contents, draws each side through the
 * editor's own projection (`storyRowProjection`) and nothing else.
 *
 * A decision the projection has nothing to say about - a scene's name, the chapter list, a row's
 * `disabled` flag - answers null, and is drawn by the generic describer as it always was.
 *
 * `story` is the author's copy of the story as the merge left it (`~mine`). A decision about a row's
 * contents carries only the contents, and what kind of row it is - which decides what the contents
 * mean - is read from there: the merge only offers a row's contents apart from its kind when both
 * sides and their base agree on the kind, so the author's copy answers for all three. The same copy
 * is the scene and the story every name in the row is resolved against.
 */
export function describeStoryMergeSides(
    decision: DocumentMergeDecision,
    story: StoryDocument | null,
    lookups: StoryRowLookups,
): MergeSidesView | null {
    const address = rowAddress(decision.path);
    if (!address) {
        return null;
    }
    const scene = story?.scenes?.[address.sceneId];
    const known = scene?.blocks?.[address.blockId];

    const blockOf = (side: DocumentMergeSide): StoryBlock | null => {
        if (!side.present) {
            return null;
        }
        if (!address.contents) {
            return isBlock(side.value) ? side.value : null;
        }
        return known ? ({ ...known, payload: side.value } as StoryBlock) : null;
    };
    const mine = blockOf(decision.mine);
    const theirs = blockOf(decision.theirs);
    // Both sides or neither. Drawing one side as a line and the other as fields would put two
    // readings of one question side by side; drawing the unreadable one as absent would claim the
    // merge removed a row it did not.
    if ((decision.mine.present && !mine) || (decision.theirs.present && !theirs)) {
        return null;
    }

    const rowLookups: StoryRowLookups = {
        ...lookups,
        ...(scene ? { scene } : {}),
        ...(story?.scenes ? { scenes: story.scenes } : {}),
        ...(story ? { document: story } : {}),
    };
    try {
        return { mine: lineView(mine, rowLookups), theirs: lineView(theirs, rowLookups) };
    } catch {
        // A row shape the projection does not know is still a decision the author can make, on the
        // generic reading - which is better than a detail pane that fails to draw.
        return null;
    }
}

/** A path that addresses one row, whole or its contents; anything else is not a line to draw. */
function rowAddress(path: readonly string[]): { sceneId: string; blockId: string; contents: boolean } | null {
    if (path[0] !== "scenes" || path[2] !== "blocks" || !path[1] || !path[3]) {
        return null;
    }
    if (path.length === 4) {
        return { sceneId: path[1], blockId: path[3], contents: false };
    }
    if (path.length === 5 && path[4] === "payload") {
        return { sceneId: path[1], blockId: path[3], contents: true };
    }
    return null;
}

function isBlock(value: unknown): value is StoryBlock {
    return value !== null
        && typeof value === "object"
        && typeof (value as { kind?: unknown }).kind === "string"
        && "payload" in (value as object);
}

/**
 * One side as the editor reads it: the speaker where the row has one, then the sentence.
 *
 * No editing placeholders - "double-click to type" is an instruction for the editor, and this row
 * cannot be typed into. Both halves lose any generated id, for the reason every verbatim value on
 * this surface does.
 */
function lineView(block: StoryBlock | null, lookups: StoryRowLookups): MergeValueView {
    if (!block) {
        return { absent: true, lines: [], hidden: 0 };
    }
    const projection = projectStoryRow(block, lookups, { editingPlaceholders: false });
    const speaker = projection.speaker?.name.trim();
    return {
        absent: false,
        lines: [{
            ...(speaker ? { name: elideGeneratedIdentifiers(speaker) } : {}),
            text: elideGeneratedIdentifiers(projection.sentence),
        }],
        hidden: 0,
    };
}
