import type { StoryBlock } from "@shared/types/story";
import type { StoryCommandContext } from "./storyCommandResolution";

/**
 * Row-level lint: the mistakes that produce a *silently wrong game* rather than a build error.
 *
 * Deliberately a mark on the row and not a problems panel. A panel is a second place to look and a
 * shape nobody has agreed on yet (overhaul plan §9); a mark is where the mistake is, and costs the
 * author nothing when there is none. Anything that already fails the build, or already has its own
 * chrome (an invalid row, a stale voice take), is not repeated here.
 *
 * The bar for a mark is that the row is *wrong*, not merely unusual. A speaker who is not on stage
 * used to be marked and no longer is: voice-overs, phone calls and a character in the next room are
 * ordinary visual-novel writing, and the mark fired on five of the twelve rows of the demo scene —
 * at which point the warning colour stops meaning anything on the rows that do need it.
 */

export type StoryRowDiagnosticCode =
    /** The row points at an asset the project no longer has. Builds ship it; the player sees nothing. */
    "missingAsset";

export type StoryRowDiagnostic = {
    code: StoryRowDiagnosticCode;
};

export type StoryRowDiagnosticInput = {
    block: StoryBlock;
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

    return null;
}
