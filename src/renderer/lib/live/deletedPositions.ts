import type { LiveBlockTarget } from "@shared/live/ops";
import type { StoryBlock, StoryBlockId, StoryScene, StorySceneId } from "@shared/types/story";

/** Where a block sat: whose child it was, and which sibling followed it. */
export type LivePosition = {
    parentId: StoryBlockId | null;
    /** The block that came after it, or null when it was the last of its parent's children. */
    beforeBlockId: StoryBlockId | null;
};

/**
 * Where every block deleted in this session used to sit.
 *
 * **It exists so that a deleted row can still be aimed at.** An author writing a line under a
 * paragraph somebody else has just removed was aiming at a place in the prose, and the end of the
 * scene is nowhere near it; with this, the host can put the new line where the vanished row stood
 * instead of at the bottom of the page. A move is the other half of the same question and does NOT
 * use this: see the host's `move-block` refusal.
 *
 * Kept for the life of the session and never trimmed. It holds two ids per deleted row, an anchor
 * can be aimed at long after the deletion scrolled out of sight, and the session's whole point is
 * that it is short next to the project's history.
 *
 * Keyed by scene as well as by block: a scene is the unit an operation names, and a position never
 * resolves across one.
 */
export class DeletedPositions {
    private readonly byScene = new Map<StorySceneId, Map<StoryBlockId, LivePosition>>();

    /** Where a block used to sit, or null if this host never saw it deleted. */
    public get(sceneId: StorySceneId, blockId: StoryBlockId): LivePosition | null {
        return this.byScene.get(sceneId)?.get(blockId) ?? null;
    }

    /**
     * Record where a block and everything under it sat.
     *
     * **Call it before the delete**, while the rows are still there to be looked at. The subtree
     * matters as much as the row itself: deleting a container takes its children with it, and a row
     * inside one is an anchor somebody may still be holding.
     */
    public remember(scene: StoryScene, blockId: StoryBlockId): void {
        let positions = this.byScene.get(scene.id);
        if (!positions) {
            positions = new Map<StoryBlockId, LivePosition>();
            this.byScene.set(scene.id, positions);
        }
        const known = positions;
        const record = (id: StoryBlockId): void => {
            const block = scene.blocks[id];
            if (!block) {
                return;
            }
            known.set(id, positionOf(scene, block));
            for (const childId of block.childrenIds) {
                record(childId);
            }
        };
        record(blockId);
    }

    /**
     * Forget a block that exists again.
     *
     * An id that is back in the scene - the same row re-inserted, which is what an undo of a delete
     * looks like from here - has a real position, and a stale memory of an older one would beat it in
     * {@link resolveInsertTarget}.
     */
    public forget(sceneId: StorySceneId, blockId: StoryBlockId): void {
        this.byScene.get(sceneId)?.delete(blockId);
    }

    /** How many positions are being kept, over all scenes. */
    public get size(): number {
        let total = 0;
        for (const positions of this.byScene.values()) {
            total += positions.size;
        }
        return total;
    }
}

/**
 * The place an insert should actually land, or null when there is no place to be found.
 *
 * A target whose anchors are all still in the scene comes back unchanged. One that names a deleted
 * row comes back pointing at where that row was, which may take more than one hop: consecutive rows
 * are deleted together often enough that the remembered successor is frequently gone too, and a row
 * inside a deleted container resolves to where the container itself stood.
 *
 * Null means the anchor is not in the scene and this host never saw it deleted - a position that
 * cannot be reconstructed rather than one at the end of the scene, because inventing an arrangement
 * nobody wrote is the more expensive mistake.
 */
export function resolveInsertTarget(
    scene: StoryScene,
    positions: DeletedPositions,
    target: LiveBlockTarget,
): LiveBlockTarget | null {
    return resolve(scene, positions, target, new Set<StoryBlockId>());
}

function resolve(
    scene: StoryScene,
    positions: DeletedPositions,
    target: LiveBlockTarget,
    seen: Set<StoryBlockId>,
): LiveBlockTarget | null {
    const parentId = target.parentId ?? null;
    if (parentId !== null && !scene.blocks[parentId]) {
        // The container the author aimed inside is gone, and its children went with it. The nearest
        // place that prose stood is where the container itself stood.
        const wasAt = positions.get(scene.id, parentId);
        if (!wasAt || seen.has(parentId)) {
            return null;
        }
        seen.add(parentId);
        return resolve(scene, positions, wasAt, seen);
    }

    let beforeBlockId = target.beforeBlockId ?? null;
    while (beforeBlockId !== null && !scene.blocks[beforeBlockId]) {
        if (seen.has(beforeBlockId)) {
            return null;
        }
        seen.add(beforeBlockId);
        const wasAt = positions.get(scene.id, beforeBlockId);
        if (!wasAt) {
            return null;
        }
        if (wasAt.parentId !== parentId) {
            // The anchor did not sit where the intent thought it did. What the host watched happen
            // beats what the sender believed, so start again from the position it was really at.
            return resolve(scene, positions, wasAt, seen);
        }
        beforeBlockId = wasAt.beforeBlockId;
    }

    return { parentId, beforeBlockId };
}

function positionOf(scene: StoryScene, block: StoryBlock): LivePosition {
    const siblings = block.parentId === null
        ? scene.rootBlockIds
        : scene.blocks[block.parentId]?.childrenIds;
    if (!siblings) {
        return { parentId: block.parentId, beforeBlockId: null };
    }
    const index = siblings.indexOf(block.id);
    const followsAnother = index >= 0 && index + 1 < siblings.length;
    return {
        parentId: block.parentId,
        beforeBlockId: followsAnother ? siblings[index + 1] : null,
    };
}
