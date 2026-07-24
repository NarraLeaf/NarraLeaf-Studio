import type { StoryBlock, StoryBlockId, StoryScene } from "./document";

/**
 * The label table of a scene - one scan, read by everything that needs to know what `/goto` may
 * address (plan 2026-07-24-006 §12.9).
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

function isLabelBlock(block: StoryBlock): block is Extract<StoryBlock, { kind: "control" }> {
    return block.kind === "control" && block.payload.control === "label" && !block.disabled;
}

/**
 * Every label declared in a scene, in the scene's document order.
 *
 * Order matters to the caller that reports a duplicate: the FIRST declaration is the one the engine
 * keeps, so the diagnostic has to name the later row.
 */
export function listSceneLabels(scene: StoryScene | null | undefined): StorySceneLabel[] {
    if (!scene) {
        return [];
    }
    const labels: StorySceneLabel[] = [];
    const visit = (blockId: StoryBlockId, seen: Set<StoryBlockId>) => {
        if (seen.has(blockId)) {
            return;
        }
        seen.add(blockId);
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        // A container's own disabled state already removed its subtree from the runtime, so its
        // labels are gone with it - the same rule the compiler applies when it skips the subtree.
        if (block.disabled) {
            return;
        }
        if (isLabelBlock(block) && block.payload.control === "label" && block.payload.name.trim()) {
            labels.push({ blockId: block.id, name: block.payload.name.trim() });
        }
        for (const childId of block.childrenIds) {
            visit(childId, seen);
        }
    };
    const seen = new Set<StoryBlockId>();
    for (const rootId of scene.rootBlockIds) {
        visit(rootId, seen);
    }
    return labels;
}

/** The label names a `/goto` in this scene may address, deduped, in declaration order. */
export function sceneLabelNames(scene: StoryScene | null | undefined): string[] {
    const names: string[] = [];
    for (const label of listSceneLabels(scene)) {
        if (!names.some(name => name.toLowerCase() === label.name.toLowerCase())) {
            names.push(label.name);
        }
    }
    return names;
}

/**
 * The labels declared more than once in a scene, keyed by the SECOND and later blocks - the rows a
 * duplicate diagnostic anchors to, since the first declaration is the one that stands.
 */
export function duplicateSceneLabels(scene: StoryScene | null | undefined): StorySceneLabel[] {
    const seen = new Set<string>();
    const duplicates: StorySceneLabel[] = [];
    for (const label of listSceneLabels(scene)) {
        const key = label.name.toLowerCase();
        if (seen.has(key)) {
            duplicates.push(label);
            continue;
        }
        seen.add(key);
    }
    return duplicates;
}
