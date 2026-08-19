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
 * Comments in English per project convention.
 */

/** A page-lane entry. Only its key matters here. */
export type StageOcclusionPageEntry = {
    key: string;
};

/** A mounted layer. Only whether it is modal matters here. */
export type StageOcclusionLayer = {
    modal: boolean;
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
    const coveredByPage = input.pageEntries.some(entry => isPageEntryDrawn({
        entryKey: entry.key,
        pagesHiddenForGame: true,
        gameHiddenKeys: input.gameHiddenKeys,
    }));
    return coveredByPage || input.layers.some(layer => layer.modal);
}
