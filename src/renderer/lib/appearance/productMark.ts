/**
 * The mark the interface draws for itself: the title bars, the launcher's sidebar, the first-run
 * preview.
 *
 * Always the leaf, whichever icon the App icon setting gives Studio's taskbar buttons, tray and Dock
 * tile (the installed shortcuts carry the Narra icon whatever it says). That setting decides how
 * Studio looks among other applications; inside its own windows the mark stays the same. Every
 * logo surface reads it from here rather than spelling the path out, so there is one place that
 * says which file it is.
 */
export const PRODUCT_MARK_SRC = "/favicon.ico";
