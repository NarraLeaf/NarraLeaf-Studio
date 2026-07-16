import { nativeTheme } from "electron/main";

/** UI theme preference persisted under the `ui.themeMode` global-state key. */
export type ThemeMode = "auto" | "light" | "dark";

/**
 * Paint-behind colors for BrowserWindows, shown between window creation and
 * the renderer's first paint. Mirror `--nl-surface` in
 * `src/renderer/styles/styles.css` — update both together.
 */
const WINDOW_BACKGROUND_DARK = "#0f1115";
const WINDOW_BACKGROUND_LIGHT = "#eef0f4";

export function normalizeThemeMode(value: unknown): ThemeMode {
    return value === "light" || value === "dark" ? value : "auto";
}

/**
 * Point Electron's nativeTheme at the persisted preference. Everything else
 * follows from this single switch: `prefers-color-scheme` in every renderer
 * (which flips the CSS tokens in styles.css — no JS involved), native menus and
 * dialogs, and the window background color below.
 */
export function applyThemeMode(value: unknown): void {
    const mode = normalizeThemeMode(value);
    nativeTheme.themeSource = mode === "auto" ? "system" : mode;
}

/** Resolved paint-behind color for new windows under the current theme. */
export function getWindowBackgroundColor(): string {
    return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND_DARK : WINDOW_BACKGROUND_LIGHT;
}
