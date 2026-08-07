/**
 * `developer` - the rows Developer options adds to the bottom of a context menu.
 *
 * Not to be confused with `devMode`, which is the window that runs the game.
 */
export const developer = {
    // Each row names what the identifier belongs to, in the word the surface it was right-clicked on
    // already uses. The surface row takes its noun from the caller because a Page and a Game UI are
    // both surfaces.
    copyId: {
        surface: "Copy {label} ID",
        element: "Copy element ID",
        asset: "Copy asset ID",
        assetGroup: "Copy group ID",
        character: "Copy character ID",
        characterGroup: "Copy group ID",
        story: "Copy story ID",
        chapter: "Copy chapter ID",
        scene: "Copy scene ID",
        storyRow: "Copy row ID",
    },
    copied: "ID copied.",
    copyFailed: "Could not copy the ID.",
} as const;
