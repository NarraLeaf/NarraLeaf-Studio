import type { StoryBlock, StoryBlockId, StoryControlBlock, StoryControlPayload, StoryScene } from "./document";
import { listSceneBlocksInDocumentOrder } from "./order";

/**
 * The label table of a scene - one scan, read by everything that needs to know what `/goto` may
 * address.
 *
 * Deliberately shaped like the declaration scans next door, and for the same reason: the row IS the
 * label, scanning the scene is how the table is built, and deleting the row deletes the label. Both
 * consumers - the command line's completion and the compiler's validation - read this one function,
 * so the names offered can never differ from the names that compile.
 *
 * Scene-wide, not position-aware: a label declared anywhere in the scene is addressable from anywhere
 * in it, which is what makes a backward `/goto` (the loop) work at all.
 *
 * `disabled` rows ARE skipped, unlike declarations. A label has runtime behaviour - it is a point the
 * play head can land on - so disabling it really does remove it, and a `goto` still pointing at it is
 * a broken jump the author needs told about rather than a silently surviving reference.
 */

export type StorySceneLabel = {
    /** The declaring block. Its id is what an editor scrolls to; the NAME is what the engine matches. */
    blockId: StoryBlockId;
    name: string;
};

type StoryLabelBlock = StoryControlBlock & { payload: Extract<StoryControlPayload, { control: "label" }> };

/** What the block IS. Whether it still counts (disabled, blank name) is the scan's business. */
function isLabelBlock(block: StoryBlock): block is StoryLabelBlock {
    return block.kind === "control" && block.payload.control === "label";
}

/**
 * Every label declared in a scene, in the scene's document order.
 *
 * Order matters to the caller that reports a duplicate: the FIRST declaration is the one the engine
 * keeps, so the diagnostic has to name the later row.
 */
export function listSceneLabels(scene: StoryScene | null | undefined): StorySceneLabel[] {
    // A container's own disabled state already removed its subtree from the runtime, so its labels
    // are gone with it - the same rule the compiler applies when it skips the subtree.
    return listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => Boolean(block.disabled) })
        .filter(isLabelBlock)
        .map(block => ({ blockId: block.id, name: block.payload.name.trim() }))
        .filter(label => label.name.length > 0);
}

/** The label names a `/goto` in this scene may address, deduped, in declaration order. */
export function sceneLabelNames(scene: StoryScene | null | undefined): string[] {
    const names: string[] = [];
    for (const label of listSceneLabels(scene)) {
        if (!names.includes(label.name)) {
            names.push(label.name);
        }
    }
    return names;
}

/**
 * The labels declared more than once in a scene, keyed by the SECOND and later blocks - the rows a
 * duplicate diagnostic anchors to, since the first declaration is the one that stands.
 *
 * Compared EXACTLY, case included, because that is what the engine does: `Scene.constructLabels`
 * keys a plain `Map` on the declared string and resolves a jump with `get`. Folding case here would
 * make Studio wrong in both directions - it would report `start` and `Start` as a duplicate the
 * engine happily accepts, and it would pass a `/goto start` aimed at a label since renamed `Start`,
 * which is exactly the `Story.build` throw this scan exists to prevent.
 */
export function duplicateSceneLabels(scene: StoryScene | null | undefined): StorySceneLabel[] {
    const seen = new Set<string>();
    const duplicates: StorySceneLabel[] = [];
    for (const label of listSceneLabels(scene)) {
        if (seen.has(label.name)) {
            duplicates.push(label);
            continue;
        }
        seen.add(label.name);
    }
    return duplicates;
}
