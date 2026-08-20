import type { StoryDocument, StorySceneId } from "@shared/types/story";
import { findDeclarationBlock } from "@shared/types/story";
import type { SearchJumpTarget } from "@/lib/workspace/services/search/searchJumpTarget";
import type { StoryCommandLineRef } from "./storyCommandLine";

/**
 * Turn a pointing word's reference into the workspace's own deep link.
 *
 * The seam the projection left open: `StoryCommandLineRef` states what a word MEANS and knows only
 * the scene it was written in, while a `SearchJumpTarget` states where to go and wants the story that
 * owns it. This is the one place that closes the gap, and it closes it towards the vocabulary the
 * whole workspace already navigates by — search hits, lint findings and asset references all land
 * through `jumpToSearchTarget`, so a word on a row lands the same way rather than through a second
 * set of navigation code that would drift from it.
 *
 * Pure, and separate from the React provider that calls it, so the mapping can be tested without a
 * workspace: getting a destination wrong is silent (the wrong tab opens and the author blames the
 * row), and that is exactly the class of failure a table-driven test catches.
 *
 * `null` means the word points at nothing reachable — a scene variable whose declaring row has since
 * been deleted, a story with no home for what the word names. The caller must then decline to offer
 * the affordance at all rather than offering a click that does nothing.
 */
export type StoryRefJumpContext = {
    /** The story the row lives in — the one thing a `StoryCommandLineRef` never carries. */
    document: StoryDocument;
    /** The scene the row lives in. Every `block` reference is scene-local by construction. */
    sceneId: StorySceneId;
    /**
     * Which library an asset id lives in.
     *
     * A search facet rather than part of the address: `jumpToSearchTarget` resolves the live asset by
     * id across every library. Supplied when the caller has the assets service in hand so the target
     * is well-formed, and left empty rather than guessed when it does not.
     */
    assetType?: (assetId: string) => string | null;
    /**
     * Whether an asset id is in fact an asset SET.
     *
     * A row stores one id for both — that is what makes a set usable in a field that took a file —
     * so which of the two a word names is a question about the project, not about the line, and the
     * projection has no business answering it. It is asked here because this is where a word turns
     * into a destination, and the destinations differ: a file opens its preview, a set is a row in
     * the library. Left out rather than guessed when the caller has no set service, in which case a
     * set id lands on the asset branch and resolves to nothing, exactly as it did before.
     */
    isAssetSet?: (assetId: string) => boolean;
};

export function storyRefJumpTarget(ref: StoryCommandLineRef, where: StoryRefJumpContext): SearchJumpTarget | null {
    const { document } = where;
    switch (ref.kind) {
        case "character":
            return { kind: "character", characterId: ref.characterId };
        case "asset":
            return where.isAssetSet?.(ref.assetId)
                ? { kind: "assetSet", assetSetId: ref.assetId }
                : { kind: "asset", assetId: ref.assetId, assetType: where.assetType?.(ref.assetId) ?? "" };
        case "scene": {
            const scene = document.scenes[ref.sceneId];
            return scene
                ? { kind: "storyScene", storyId: document.id, sceneId: ref.sceneId, storyName: document.name, sceneName: scene.name }
                : null;
        }
        case "block":
            return sceneBlockTarget(where, where.sceneId, ref.blockId);
        case "variable": {
            if (ref.target.scope !== "scene") {
                // A project variable is authored in the variables panel, not in any row, so the panel
                // is the whole of its address — see the note on the target's own declaration.
                return { kind: "storyVariable", scope: ref.target.scope, variableId: ref.target.variableId };
            }
            // A scene variable IS a row: the declaration block's id is the variable's identity (v6),
            // so the word leads to the line that declares it, like every other row-to-row jump.
            const found = findDeclarationBlock(document, ref.target.variableId);
            return found ? sceneBlockTarget(where, found.sceneId, found.block.id) : null;
        }
    }
}

function sceneBlockTarget(where: StoryRefJumpContext, sceneId: StorySceneId, blockId: string): SearchJumpTarget | null {
    const scene = where.document.scenes[sceneId];
    if (!scene?.blocks[blockId]) {
        return null;
    }
    return {
        kind: "storyBlock",
        storyId: where.document.id,
        sceneId,
        blockId,
        storyName: where.document.name,
        sceneName: scene.name,
    };
}
