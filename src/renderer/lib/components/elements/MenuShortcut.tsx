import React from "react";

/**
 * The chord printed at the right of a menu row.
 *
 * Subdued rather than muted: the row's own words are what an author is reading down the menu for,
 * and the chord is there to be found once - the note that says this command has a key, and which.
 * Tabular figures so the F-keys line up down the column instead of shuffling by a pixel each.
 *
 * Renders nothing when there is no chord, so a row without one is not given an empty column.
 */
export function MenuShortcut({ of }: { of?: string }) {
    if (!of) {
        return null;
    }
    return <span className="shrink-0 whitespace-nowrap text-sm text-fg-subtle tabular-nums">{of}</span>;
}
