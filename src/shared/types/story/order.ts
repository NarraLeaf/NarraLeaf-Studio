import type { StoryBlock, StoryBlockId, StoryDocument, StorySceneId, StoryScene } from "./document";

/**
 * The two orderings a story document states explicitly, in one place because they exist for one
 * reason: a JSON object is a lookup table, and nothing here may read sequence out of one.
 *
 * Key order looks dependable - `JSON.parse` keeps insertion order for non-integer-like keys - and
 * that is exactly what makes it dangerous. It survives until the first thing that rebuilds the
 * record: a `{...spread}`, a `map`/`filter` refill, or the canonical serializer this milestone
 * adopts, which sorts keys and so reorders the whole document by UUID. Everything below reads a
 * declared array instead, and falls back to record order only for entries no array mentions.
 */

/**
 * Every block of a scene in the order the author reads it: `rootBlockIds`, then each block's
 * `childrenIds`, depth first. This is the same walk the compiler executes.
 *
 * It is NOT `Object.values(scene.blocks)`. `insertBlockInScene` appends a new block to the record
 * whatever position it takes in the tree, so a row inserted at the top of a scene is stored last -
 * which is how the variable table came to show a freshly declared variable at the bottom while its
 * row sat at the top of the scene.
 *
 * `skipSubtree` prunes: the block is neither returned nor descended into. One predicate rather than
 * two because the callers that skip a block always mean its children as well - disabling a container
 * takes its whole subtree out of the runtime, so a label inside it is gone with it.
 *
 * The visited set is not tidiness. A `childrenIds` cycle - which only corruption produces, but a
 * corrupt document is one Studio still has to open to repair - would otherwise hang the editor.
 */
export function listSceneBlocksInDocumentOrder(
    scene: StoryScene | null | undefined,
    options?: { skipSubtree?: (block: StoryBlock) => boolean },
): StoryBlock[] {
    if (!scene) {
        return [];
    }
    const ordered: StoryBlock[] = [];
    const seen = new Set<StoryBlockId>();
    const visit = (blockId: StoryBlockId) => {
        if (seen.has(blockId)) {
            return;
        }
        seen.add(blockId);
        const block = scene.blocks[blockId];
        if (!block || options?.skipSubtree?.(block)) {
            return;
        }
        ordered.push(block);
        for (const childId of block.childrenIds) {
            visit(childId);
        }
    };
    for (const rootId of scene.rootBlockIds) {
        visit(rootId);
    }
    return ordered;
}

/**
 * Every scene of a document in authoring order: chapters in order, each chapter's `sceneIds` in
 * order, then the scenes no chapter claims in `unassignedSceneIds` order.
 *
 * Scenes that neither structure mentions are appended in record order. That tail is what keeps this
 * total - a scene created since the document was last normalized is not in `unassignedSceneIds` yet,
 * and a scene that vanished from every list must still be reachable rather than invisible.
 *
 * Ids are deduplicated on first mention, so a scene left in `unassignedSceneIds` after being dragged
 * into a chapter reads at its chapter position, not twice. Nothing needs to prune that stale entry
 * for reads to be right; `normalizeStoryDocument` clears it on the next load.
 */
export function listSceneIdsInDocumentOrder(document: StoryDocument): StorySceneId[] {
    const ordered: StorySceneId[] = [];
    const seen = new Set<StorySceneId>();
    const take = (sceneId: StorySceneId) => {
        if (seen.has(sceneId) || !document.scenes[sceneId]) {
            return;
        }
        seen.add(sceneId);
        ordered.push(sceneId);
    };
    // `chapters` is typed required, but this sits under the variable scans, which run against
    // documents assembled by callers rather than read from disk (bundles forwarded over IPC, an
    // inspector's partial view). A story with no chapter list still has scenes worth listing.
    for (const chapter of document.chapters ?? []) {
        for (const sceneId of chapter.sceneIds ?? []) {
            take(sceneId);
        }
    }
    for (const sceneId of document.unassignedSceneIds ?? []) {
        take(sceneId);
    }
    for (const sceneId of Object.keys(document.scenes)) {
        take(sceneId);
    }
    return ordered;
}

/** {@link listSceneIdsInDocumentOrder}, resolved to the scenes themselves. */
export function listScenesInDocumentOrder(document: StoryDocument): StoryScene[] {
    return listSceneIdsInDocumentOrder(document).map(sceneId => document.scenes[sceneId]);
}

/**
 * The scenes no chapter claims, in the order {@link listSceneIdsInDocumentOrder} will read them -
 * what `unassignedSceneIds` has to hold to state that order rather than leave it to key order.
 *
 * Derived from the document as it stands, which is what makes both callers correct: the v11→v12
 * migration runs it on a freshly parsed document, where the record's key order still IS the authored
 * order, and `normalizeStoryDocument` runs it on every load, where the existing array leads and only
 * scenes it never mentioned fall back to key order.
 */
export function deriveUnassignedSceneIds(document: StoryDocument): StorySceneId[] {
    const claimed = new Set<StorySceneId>();
    for (const chapter of document.chapters ?? []) {
        for (const sceneId of chapter.sceneIds ?? []) {
            claimed.add(sceneId);
        }
    }
    return listSceneIdsInDocumentOrder(document).filter(sceneId => !claimed.has(sceneId));
}
