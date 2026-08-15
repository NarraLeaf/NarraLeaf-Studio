import type { StoryBlockId, StoryScene } from "@shared/types/story";
import type { NarralangIssue, NarralangIssueReason, NarralangLookups } from "@/lib/story/narralang/narralangPrinter";
import { describeStoryBlock, type StoryRowLookups } from "@/lib/story/storyRowProjection";
import type { Character } from "@/lib/workspace/services/character/Character";
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

/**
 * `characterId, refId → name`, over every pose of a preset character and every tag of a layered one.
 *
 * Built the way `buildStoryCommandContext` builds its own appearance table - tags flat across axes,
 * because the engine resolves a tag against the group that owns it and no surface has to say which
 * axis the author meant. A puppet character contributes nothing: what it looks like is named by the
 * model its backend loaded, and the printer takes that name off the payload.
 */
export function narralangAppearanceNames(
    characters: readonly Character[],
): NonNullable<StoryRowLookups["appearanceName"]> {
    const byCharacter = new Map<string, Map<string, string>>();
    for (const character of characters) {
        const appearance = character.profile.appearance;
        const names = new Map<string, string>();
        if (appearance.getKind() === "preset") {
            for (const pose of appearance.getPoses()) {
                names.set(pose.id, pose.name);
            }
        } else {
            for (const axis of appearance.getAxes()) {
                for (const tag of axis.tags) {
                    names.set(tag.id, tag.name);
                }
            }
        }
        byCharacter.set(character.profile.getId(), names);
    }
    return (characterId, refId) => byCharacter.get(characterId)?.get(refId) ?? null;
}

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
    /** Every reason this row hit, first occurrence first. A row can fail more than one way. */
    reasons: NarralangIssueReason[];
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
            if (!existing.reasons.includes(issue.reason)) {
                existing.reasons.push(issue.reason);
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
            reasons: [issue.reason],
        };
        byBlockId.set(issue.blockId, row);
        rows.push(row);
    }
    return rows;
}
