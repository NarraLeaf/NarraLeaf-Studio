import { AppHost, AppProtocol } from "@shared/types/constants";

/**
 * Which built-in icon Studio wears while it runs: on its windows, taskbar buttons and tray on
 * Windows, and on its Dock tile on macOS.
 *
 * Only there. The interface's own logo surfaces - title bars, the launcher's sidebar, the idle-editor
 * watermark - keep the leaf whatever this says (`PRODUCT_MARK_SRC` in the renderer).
 *
 * Shared because the two halves of the feature live in different processes: the Settings row is a
 * renderer registry entry, while only the main process can hand a file to `BrowserWindow.setIcon`
 * or `app.dock.setIcon`.
 *
 * The stored value is an **id**, never a path. A renderer that could name the file could name any
 * file, and this one is read straight off disk and handed to the OS - so the renderer picks from a
 * list the main process already trusts, and the main process resolves the id itself.
 *
 * The key keeps its original name from when the choice only reached Windows' windows. Renaming it
 * would forget every choice already made.
 */
export const WINDOW_ICON_KEY = "ui.windowIcon";

/** Narra with the leaf in her hair: what Studio installs as, and what its shortcuts carry. */
export const WINDOW_ICON_DEFAULT = "narra";

/**
 * A built-in icon and the resource files that carry it, relative to the resources dir.
 *
 * Every icon comes in two shapes because the platforms draw icons differently, and each is used
 * where it belongs:
 *
 * - `ico` is the Windows tile, a rounded square that fills its frame, with several sizes so the
 *   taskbar can pick one instead of downsampling a single bitmap.
 * - `png` is the same icon on Apple's grid (the body inset to 824 of 1024, the corners a
 *   superellipse), for the macOS Dock and for Linux. The Dock draws what it is given without
 *   masking it, so a Windows tile there would sit larger and squarer than everything beside it.
 *
 * `project/build/prepare-studio-icons.js` derives the variants nobody drew by hand.
 */
export interface WindowIconEntry {
    id: string;
    ico: string;
    png: string;
}

export const WINDOW_ICONS: readonly WindowIconEntry[] = [
    { id: WINDOW_ICON_DEFAULT, ico: "studio-icon/narra.ico", png: "studio-icon/narra.png" },
    { id: "leafWhite", ico: "studio-icon/leaf-white.ico", png: "studio-icon/leaf-white.png" },
    { id: "leaf", ico: "studio-icon/leaf.ico", png: "studio-icon/leaf.png" },
];

export const WINDOW_ICON_IDS: readonly string[] = WINDOW_ICONS.map(icon => icon.id);

/**
 * The entry an id names, falling back to the default.
 *
 * The fallback is the point: the value can outlive the icon it names - a hand-edited
 * `global.json`, a profile carried to a build where that icon was dropped, or the ids of an older
 * Studio (`default`, which was the leaf when the leaf was the default). Falling back leaves Studio
 * wearing the shipped icon; not falling back leaves it wearing Electron's.
 */
export function resolveWindowIcon(id: string | undefined | null): WindowIconEntry {
    return WINDOW_ICONS.find(icon => icon.id === id) ?? WINDOW_ICONS[0];
}

/**
 * The `app://` URL that serves an icon's Windows tile, for the Settings row to preview each choice.
 *
 * The id sits in the path rather than in a query string, so picking a different mark is a
 * different URL: the cache never has to be invalidated, and each answer stays immutable. The main
 * process resolves the id through `resolveWindowIcon` and serves nothing else, so an id nobody
 * declares yields the default mark rather than a broken image.
 */
export function windowIconUrl(id: string | undefined | null): string {
    return `${AppProtocol}://${AppHost.AppIcon}/${encodeURIComponent(resolveWindowIcon(id).id)}`;
}
