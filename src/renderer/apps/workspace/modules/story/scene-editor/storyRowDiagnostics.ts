import type { StoryBlock } from "@shared/types/story";
import type { CharacterAppearanceRef } from "./storySceneEditorTypes";
import type { StoryCommandContext } from "./storyCommandResolution";

/**
 * Row-level lint: the two mistakes that produce a *silently wrong game* rather than a build error.
 *
 * Deliberately a mark on the row and not a problems panel. A panel is a second place to look and a
 * shape nobody has agreed on yet (overhaul plan §9); a mark is where the mistake is, and costs the
 * author nothing when there is none. Anything that already fails the build, or already has its own
 * chrome (an invalid row, a stale voice take), is not repeated here.
 */

export type StoryRowDiagnosticCode =
    /**
     * A character says a line without ever having been shown. NarraLeaf will not put them on stage on
     * its own — the bible rules out implicit auto-enter — so this plays as a voice from nowhere. It is
     * legal, hence a mark and not an error: a disembodied line is sometimes the point.
     */
    | "speakerNotShown"
    /** The row points at an asset the project no longer has. Builds ship it; the player sees nothing. */
    | "missingAsset";

export type StoryRowDiagnostic = {
    code: StoryRowDiagnosticCode;
};

export type StoryRowDiagnosticInput = {
    block: StoryBlock;
    /** The speaker's accumulated stage state at this row, from `buildDialogueAppearances`. */
    appearance?: CharacterAppearanceRef;
    context: StoryCommandContext;
};

/** Whether an asset id still resolves to something in the project, in any of the three libraries. */
function assetExists(context: StoryCommandContext, assetId: string): boolean {
    return context.images.some(asset => asset.id === assetId)
        || context.audio.some(asset => asset.id === assetId)
        || context.videos.some(asset => asset.id === assetId);
}

/** The asset a row points at, when it points at one by id. */
function referencedAssetId(block: StoryBlock): string | undefined {
    if (block.kind !== "action") {
        return undefined;
    }
    const payload = block.payload as { assetId?: unknown };
    return typeof payload.assetId === "string" && payload.assetId ? payload.assetId : undefined;
}

export function diagnoseRow(input: StoryRowDiagnosticInput): StoryRowDiagnostic | null {
    const { block } = input;

    const assetId = referencedAssetId(block);
    if (assetId && !assetExists(input.context, assetId)) {
        return { code: "missingAsset" };
    }

    if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
        // A bare-name speaker has no character to show, so there is nothing to have forgotten. Only a
        // line bound to a real character can be missing its entrance.
        if (block.payload.characterId && !input.appearance?.shown) {
            return { code: "speakerNotShown" };
        }
    }

    return null;
}
