import type { StoryBlock } from "@shared/types/story";
import type { StoryCommandContext } from "./storyCommandResolution";
import { puppetChannelNames, type StoryPuppetChannel } from "./storyCommandValues";

/**
 * Row-level lint: the mistakes that produce a *silently wrong game* rather than a build error.
 *
 * Deliberately a mark on the row and not a problems panel. A panel is a second place to look and a
 * shape nobody has agreed on yet; a mark is where the mistake is, and costs the
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
    | "missingAsset"
    /**
     * The row asks a puppet's model for a motion / expression / skin the model says it does not have.
     *
     * The same failure mode as a missing asset, one layer further out: the compile is happy (the name
     * is forwarded verbatim, as the engine's contract requires), the build ships, and the backend logs
     * a warning nobody reads while the model plainly does not do the thing. A typo, or an animation
     * dropped in a re-export.
     */
    | "unknownPuppetName";

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

/**
 * The channel a character row asks a puppet's model for, or null for a row that asks for none.
 *
 * Only the three operations that carry a `puppetName`. `expression` is shared with the two appearance
 * kinds Studio draws itself, which is why the name has to be present before the row counts as a puppet
 * one - a preset character's `expression` row carries a `pose`, never a `puppetName`.
 */
function requestedPuppetChannel(block: StoryBlock): { characterId: string; channel: StoryPuppetChannel; name: string } | null {
    if (block.kind !== "action" || block.payload.action !== "character") {
        return null;
    }
    const payload = block.payload;
    const name = payload.puppetName?.trim();
    // Blank is the engine's `null` - the request to clear that channel, which every model can honour.
    if (!payload.characterId || !name) {
        return null;
    }
    switch (payload.operation) {
        case "expression":
            return { characterId: payload.characterId, channel: "expression", name };
        case "setMotion":
            return { characterId: payload.characterId, channel: "motion", name };
        case "setSkin":
            return { characterId: payload.characterId, channel: "skin", name };
        default:
            return null;
    }
}

/** The parameter ids a `setParams` row asks for, or null for any other row. */
function requestedPuppetParams(block: StoryBlock): { characterId: string; ids: string[] } | null {
    if (block.kind !== "action" || block.payload.action !== "character" || block.payload.operation !== "setParams") {
        return null;
    }
    const characterId = block.payload.characterId;
    const ids = Object.keys(block.payload.params ?? {}).map(id => id.trim()).filter(id => id !== "");
    return characterId && ids.length > 0 ? { characterId, ids } : null;
}

export function diagnoseRow(input: StoryRowDiagnosticInput): StoryRowDiagnostic | null {
    const { block } = input;

    const assetId = referencedAssetId(block);
    if (assetId && !assetExists(input.context, assetId)) {
        return { code: "missingAsset" };
    }

    const requestedParams = requestedPuppetParams(block);
    if (requestedParams) {
        // The same two silences as the channels below - and the same reason the list has to be non-empty
        // before it means anything: a model that reports no parameters has not said that every id is
        // wrong, only that it does not enumerate them.
        const known = input.context.puppetByCharacterId[requestedParams.characterId]?.params ?? [];
        if (known.length > 0 && requestedParams.ids.some(id => !known.some(spec => spec.id === id))) {
            return { code: "unknownPuppetName" };
        }
    }

    const requested = requestedPuppetChannel(block);
    if (requested) {
        const names = puppetChannelNames(input.context, requested.characterId, requested.channel);
        // Two silences, both required. No entry for this character means nobody could ask its model -
        // no runtime on this machine, or a backend that describes nothing - and marking every row in a
        // project that merely opened somewhere else would make the colour meaningless. An entry with an
        // EMPTY list on this channel is a model that had nothing to say about it, which is "no comment"
        // and not "no name is valid": a Spine skeleton reports eleven animations and zero expressions.
        if (names.length > 0 && !names.includes(requested.name)) {
            return { code: "unknownPuppetName" };
        }
    }

    return null;
}
