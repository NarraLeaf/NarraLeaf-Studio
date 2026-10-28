import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import { collectStoryCharacterIds } from "../scene-editor/storyForeignPaste";

/**
 * How the outline lays out a scene row.
 *
 * `comfortable` is the two-line row the outline always had: the name, and under it what the scene
 * holds. `compact` folds that onto the name's own line, so a long story fits more scenes on screen.
 * Named after the scene editor's own densities, so one word means the same direction in both places.
 */
export type StoryOutlineDensity = "comfortable" | "compact";

export const DEFAULT_STORY_OUTLINE_DENSITY: StoryOutlineDensity = "compact";

export function normalizeStoryOutlineDensity(value: unknown): StoryOutlineDensity {
    return value === "comfortable" || value === "compact" ? value : DEFAULT_STORY_OUTLINE_DENSITY;
}

/**
 * Below this panel width a compact row stops carrying its line count and shows fewer faces: the name
 * is what the row is for, and at the outline's 44px indent the count and three faces left it about
 * four characters.
 */
export const STORY_OUTLINE_NARROW_PX = 240;

/** How many faces a scene row shows before the rest become `+N`. */
export function storyOutlineCastCap(density: StoryOutlineDensity, narrow: boolean): number {
    if (density === "comfortable") {
        // The second line has the row's whole width to itself.
        return 6;
    }
    return narrow ? 2 : 3;
}

/**
 * The characters a scene puts in front of the player, in the order they first appear.
 *
 * Same two sites `collectStoryCharacterIds` reads - a dialogue row's speaker and a character stage
 * row's subject - over every row the scene compiles. A disabled row is compiled out with its whole
 * subtree, so a character who only appears under one is not in the scene and is not pictured.
 */
export function storySceneCastIds(scene: StoryScene): string[] {
    const blocks: StoryBlock[] = [];
    const walk = (blockId: StoryBlockId): void => {
        const block = scene.blocks[blockId];
        if (!block || block.disabled) {
            return;
        }
        blocks.push(block);
        for (const childId of block.childrenIds) {
            walk(childId);
        }
    };
    for (const rootId of scene.rootBlockIds) {
        walk(rootId);
    }
    return collectStoryCharacterIds(blocks);
}
