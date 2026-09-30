import type { StoryBlockId, StoryScene } from "@shared/types/story";
import type { NarralangIssue, NarralangIssueDetail, NarralangIssueReason, NarralangLookups } from "@/lib/story/narralang/narralangPrinter";
import { describeStoryBlock } from "@/lib/story/storyRowProjection";
import { exportFileName } from "../script/storyScriptIo";

/**
 * What the NarraLang printer needs from the project, and what its report needs to become sentences.
 *
 * The same split the `.txt` codec lives by (see `storyScriptIo`): the printer is pure - it holds a
 * scene and produces text, never a workspace service - so everything it has to ask about the world
 * outside a scene arrives as lookups built here, without React.
 *
 * Filling these in is not cosmetic. Every id the printer cannot resolve to a name is an
 * `unresolvedRef` issue, so a half-built lookup table does not degrade the file, it reports the whole
 * scene as unspeakable.
 */

/** The file name a native save dialog opens with. `.nl` is the NarraLang extension. */
export function narralangFileName(name: string): string {
    return exportFileName(name, "nl");
}

/** One row of the export report: which scene it is in, what it says, and why it has no spelling. */
export type NarralangIssueRow = {
    /** Stable across a render, and never shown: React keys only. */
    blockId: StoryBlockId;
    /** The scene the row belongs to. Empty when the export covered a single scene. */
    sceneName: string;
    /** The row as a sentence - `describeStoryBlock`, the same one the editor's row list shows. */
    description: string;
    /**
     * Every reason this row hit, first occurrence first. A row can fail more than one way, and the
     * same reason twice for different things - a row naming a missing asset AND a missing character
     * is two entries, because "points at something that no longer exists" twice would read as a
     * repeat rather than as two separate dangling references.
     */
    reasons: { reason: NarralangIssueReason; detail?: NarralangIssueDetail }[];
};

/**
 * The printer's issues as rows an author can find in their story.
 *
 * Grouped by block rather than listed one issue per line, because "9 issues" over three rows reads as
 * nine problems when it is three - and because the count in the heading has to be a count of *rows*,
 * which is what the author goes looking for.
 *
 * `scenes` is every scene the export covered, in the order it wrote them; the issue itself carries
 * only a block id, so the scene is recovered by lookup. Nothing here ever prints an id: a row that
 * resolves to no block is dropped rather than named by its identifier.
 */
export function narralangIssueRows(
    issues: readonly NarralangIssue[],
    scenes: readonly StoryScene[],
    lookups: NarralangLookups,
): NarralangIssueRow[] {
    const rows: NarralangIssueRow[] = [];
    const byBlockId = new Map<StoryBlockId, NarralangIssueRow>();
    for (const issue of issues) {
        const existing = byBlockId.get(issue.blockId);
        if (existing) {
            if (!existing.reasons.some(held => held.reason === issue.reason && held.detail === issue.detail)) {
                existing.reasons.push({ reason: issue.reason, detail: issue.detail });
            }
            continue;
        }
        const scene = scenes.find(candidate => candidate.blocks[issue.blockId] !== undefined);
        const block = scene?.blocks[issue.blockId];
        if (!scene || !block) {
            continue;
        }
        const row: NarralangIssueRow = {
            blockId: issue.blockId,
            sceneName: scenes.length > 1 ? scene.name : "",
            // The row's own sentence, resolved through the same lookups the printer ran on, so the
            // report names a background by its asset name rather than by what the payload stores.
            description: describeStoryBlock(block, { ...lookups, scene }),
            reasons: [{ reason: issue.reason, detail: issue.detail }],
        };
        byBlockId.set(issue.blockId, row);
        rows.push(row);
    }
    return rows;
}
