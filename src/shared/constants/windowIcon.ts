/**
 * Which built-in mark Studio's own windows wear.
 *
 * Shared because the two halves of the feature live in different processes: the Settings row is a
 * renderer registry entry, while only the main process can hand a file to `BrowserWindow.setIcon`.
 *
 * The stored value is an **id**, never a path. A renderer that could name the file could name any
 * file, and this one is read straight off disk and handed to the OS - so the renderer picks from a
 * list the main process already trusts, and the main process resolves the id itself.
 */
export const WINDOW_ICON_KEY = "ui.windowIcon";

/** NarraLeaf's own leaf mark: what Studio shipped as, and what the installer still writes. */
export const WINDOW_ICON_DEFAULT = "default";

/**
 * A built-in icon and the two resource files that carry it.
 *
 * Both formats exist for every entry because the platforms disagree about which they want:
 * Windows takes the `.ico`, whose several sizes let the taskbar pick one instead of downsampling
 * a single bitmap; everything else takes the PNG.
 */
export interface WindowIconEntry {
    id: string;
    /** Resource file names, resolved against the resources dir by the main process. */
    ico: string;
    png: string;
}

export const WINDOW_ICONS: readonly WindowIconEntry[] = [
    { id: WINDOW_ICON_DEFAULT, ico: "app-icon.ico", png: "app-icon.png" },
    { id: "narra", ico: "app-icon-narra.ico", png: "app-icon-narra.png" },
];

export const WINDOW_ICON_IDS: readonly string[] = WINDOW_ICONS.map(icon => icon.id);

/**
 * The entry an id names, falling back to the default.
 *
 * The fallback is the point: the value can outlive the icon it names - a hand-edited
 * `global.json`, or a profile carried to a build where that icon was dropped. Falling back leaves
 * Studio wearing the wrong mark; not falling back leaves it wearing Electron's.
 */
export function resolveWindowIcon(id: string | undefined | null): WindowIconEntry {
    return WINDOW_ICONS.find(icon => icon.id === id) ?? WINDOW_ICONS[0];
}
