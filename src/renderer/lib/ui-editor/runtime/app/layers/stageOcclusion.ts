/**
 * Is the stage the screen, or is the player looking at something drawn over it?
 *
 * Beside {@link resolveCompositeInput} rather than inside it: that one arbitrates between the things
 * the surface system draws, and this one asks about the one thing it does not - the game stage
 * underneath all of them. Both lanes can cover it, so both are asked here.
 *
 * ## The page lane
 *
 * A running game takes the screen from the page lane rather than emptying it: the entries that were
 * open are marked hidden and stay on the stack (`hideCurrentStudioPagesForGame`), and the surface
 * stack draws every entry that is not one of them. So "a page is drawn over the game" is exactly
 * that filter with the hidden entries removed, which is why {@link isPageEntryDrawn} is the same
 * function the renderer uses to decide what to paint - a second expression saying the same thing is
 * a second expression to forget to update.
 *
 * Deliberately NOT `presentation === "gameOverlay"`, which is the stamp a page gets for being opened
 * while a game runs and the fact `Is Game Overlay` reports. It is right for the page asking about
 * itself and wrong here: quitting to an ending page leaves the settings screen the player quit from
 * on the stack, and the next playthrough hides it along with everything else - so the stamp says
 * "covered" over a stage with nothing on it, for the whole run.
 *
 * ## The layer lane
 *
 * Modal layers only. A modal layer declares that everything below it goes inert and the keys are
 * its - the layer lane's own statement that the player is not interacting with what is underneath.
 * A layer that declares no such thing (a toast, a HUD) leaves the stage exactly as live as it was.
 *
 * ## Covers count when they are on the screen, not when they are on a stack
 *
 * Both lanes hold more than the screen shows. The page lane draws the entry it is settling on (and,
 * mid-transition, the one leaving) and nothing buried under them; the layer stack holds layers the
 * host filtered out of the render, which is the whole reason it tracks `unrenderedKeys`. Reading
 * either stack whole reports a cover that nothing is drawing, and one reader cannot survive that:
 * the suspension `stageAdvanceHold` takes is handed back when this answer turns false, so an answer
 * that is true with an empty screen is a story that never advances again. MEASURED: the in-game
 * Save panel opened and closed left one suspension out on the live `GameState` for the rest of the
 * playthrough - stage click, advance key and auto-forward all dead - with nothing over the stage.
 *
 * So the page half asks the entry the lane is settling on, and the layer half skips a layer whose
 * page the running bundle does not contain. Whenever the entries a game hid are the prefix they are
 * built to be, asking the top and asking the whole stack are the same question; they part only once
 * the stack says something the screen does not, and then the screen is right.
 *
 * Comments in English per project convention.
 */

/** A page-lane entry. Only its key matters here. */
export type StageOcclusionPageEntry = {
    key: string;
};

/** A mounted layer: whether it takes the screen, and which page it would draw to take it. */
export type StageOcclusionLayer = {
    modal: boolean;
    surfaceId: string;
};

export type StageOcclusionInput = {
    /** The page lane's stack, bottom to top. The logical stack, not the entries mid-transition. */
    pageEntries: readonly StageOcclusionPageEntry[];
    /** Whether a game has taken the screen from the page lane. */
    pagesHiddenForGame: boolean;
    /** The entries the game hid when it took the screen. */
    gameHiddenKeys: ReadonlySet<string>;
    /** The layers mounted over the page lane, bottom to top. */
    layers: readonly StageOcclusionLayer[];
    /**
     * The pages the running bundle can actually draw.
     *
     * A layer naming anything else is filtered out of the render and covers nothing. Optional
     * because a caller that has no bundle to ask (a test, a stack driven with no renderer behind it)
     * should keep counting every layer, which is what it always did.
     */
    drawableSurfaceIds?: ReadonlySet<string> | null;
};

/**
 * Whether the surface stack draws this page entry at all.
 *
 * With no game on screen every entry is drawn; with one, the entries it hid are not.
 */
export function isPageEntryDrawn(input: {
    entryKey: string;
    pagesHiddenForGame: boolean;
    gameHiddenKeys: ReadonlySet<string>;
}): boolean {
    return !input.pagesHiddenForGame || !input.gameHiddenKeys.has(input.entryKey);
}

/**
 * Whether anything is drawn over the game stage right now.
 *
 * False whenever no game has taken the screen: there is no stage to cover, and the pages on the
 * stack are the app, not something over it.
 */
export function isStageCovered(input: StageOcclusionInput): boolean {
    if (!input.pagesHiddenForGame) {
        return false;
    }
    const settling = input.pageEntries[input.pageEntries.length - 1] ?? null;
    const coveredByPage = settling !== null && isPageEntryDrawn({
        entryKey: settling.key,
        pagesHiddenForGame: true,
        gameHiddenKeys: input.gameHiddenKeys,
    });
    return coveredByPage || input.layers.some(layer => layer.modal && isLayerDrawn({
        surfaceId: layer.surfaceId,
        drawableSurfaceIds: input.drawableSurfaceIds,
    }));
}

/**
 * Whether the surface stack can put this layer on the screen.
 *
 * True when the caller did not say which pages the bundle has: a stack asked about with no renderer
 * behind it reports every layer it holds, which is what it did before this question existed.
 */
export function isLayerDrawn(input: {
    surfaceId: string;
    drawableSurfaceIds?: ReadonlySet<string> | null;
}): boolean {
    return !input.drawableSurfaceIds || input.drawableSurfaceIds.has(input.surfaceId);
}
