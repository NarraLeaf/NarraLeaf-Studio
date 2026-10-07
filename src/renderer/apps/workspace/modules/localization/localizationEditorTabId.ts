export type LocalizationEditorTabPayload = {
    locale: string;
    /**
     * A row to bring on screen and mark: a deep link into the table, as a search hit or a project
     * check finding asks for one.
     *
     * `storyId` names the source the row is listed under; absent means the interface's words, unless
     * the unit is a character's name, which heads every story's rows. `token` makes asking for the
     * same row twice two requests rather than one - see {@link nextTableRevealToken}.
     */
    reveal?: { unitId: string; storyId?: string; token: number };
    /**
     * Open on the language's orphans - its translations whose line is no longer in the game - as a
     * project check finding about them asks. `token` as for {@link reveal}.
     */
    orphans?: { token: number };
};

/** Stable per-locale tab id so re-opening focuses the existing tab instead of duplicating it. */
export function getLocalizationEditorTabId(locale: string): string {
    return `localization:table:${locale}`;
}

let tableRevealToken = 0;

/**
 * The token for one request to reveal a row in a translation or voice table.
 *
 * One counter for every caller, because a table tells a new request from the one it already handled
 * by the token alone: two callers counting for themselves would both send `1`, and the second
 * request for a row the first had just revealed would be taken for the first and do nothing.
 */
export function nextTableRevealToken(): number {
    tableRevealToken += 1;
    return tableRevealToken;
}
