/**
 * The custom-background settings, shared by the dialog that edits them and the layer that paints
 * them. All of them live in global state so every window repaints together; the workspace is the
 * only writer, and the Settings window just asks it to open the dialog.
 */

export const BACKGROUND_FILLS = ["cover", "contain", "tile", "center"] as const;
export type BackgroundFill = (typeof BACKGROUND_FILLS)[number];

/** Reading order of the 3×3 anchor grid, so the dialog can map it straight onto a CSS position. */
export const BACKGROUND_ANCHORS = [
    "left top",
    "center top",
    "right top",
    "left center",
    "center center",
    "right center",
    "left bottom",
    "center bottom",
    "right bottom",
] as const;
export type BackgroundAnchor = (typeof BACKGROUND_ANCHORS)[number];

/** Largest blur the slider offers, in CSS pixels. 0 means the picture stays sharp. */
export const BACKGROUND_BLUR_MAX = 40;

/**
 * Range of the two plate sliders, in percent. No 0: with a plate switched on, a fully clear plate
 * would be the switch's off position under another name.
 */
export const BACKGROUND_PLATE_OPACITY_MIN = 10;
export const BACKGROUND_PLATE_OPACITY_MAX = 100;
export const BACKGROUND_PLATE_OPACITY_STEP = 5;

/**
 * The custom properties the two plates take their alpha from: `.nl-editor-surface` (the editor's
 * reading surfaces) and `.nl-sidebar-surface` (the docks) in styles.css. Published on the workspace
 * root next to `.nl-has-workspace-bg`, so they exist exactly where a wallpaper does and every other
 * window keeps its opaque paint.
 */
export const BACKGROUND_EDITOR_ALPHA_VAR = "--nl-editor-surface-alpha";
export const BACKGROUND_SIDEBAR_ALPHA_VAR = "--nl-sidebar-surface-alpha";

export interface BackgroundSettings {
    /** File name inside the userData/backgrounds cache, or null when no background is set. */
    image: string | null;
    /** Percent, 2–40: watermark strength. */
    opacity: number;
    fill: BackgroundFill;
    anchor: BackgroundAnchor;
    /** Blur radius in CSS pixels, 0–40. 0 disables the filter entirely. */
    blur: number;
    /**
     * Whether the editor's reading surfaces (story prose, text editor) keep a plate of their own over
     * the wallpaper. Off by default: the editor area is where the picture has room to be seen.
     */
    editorFill: boolean;
    /** Percent, 10–100: the editor plate's opacity while `editorFill` is on. */
    editorOpacity: number;
    /**
     * Whether the docks (left and right sidebars, bottom panel) keep a plate over the wallpaper. On
     * by default: they hold trees, lists and fields in small, dim type that a photograph behind them
     * swallows, and solid docks frame the picture instead of cutting it into strips.
     */
    sidebarFill: boolean;
    /** Percent, 10–100: the dock plate's opacity while `sidebarFill` is on. */
    sidebarOpacity: number;
}

export const BACKGROUND_KEYS: Record<keyof BackgroundSettings, string> = {
    image: "ui.backgroundImage",
    opacity: "ui.backgroundOpacity",
    fill: "ui.backgroundFill",
    anchor: "ui.backgroundAnchor",
    blur: "ui.backgroundBlur",
    editorFill: "ui.backgroundEditorFill",
    editorOpacity: "ui.backgroundEditorOpacity",
    sidebarFill: "ui.backgroundSidebarFill",
    sidebarOpacity: "ui.backgroundSidebarOpacity",
};

export const DEFAULT_BACKGROUND: BackgroundSettings = {
    image: null,
    opacity: 8,
    fill: "cover",
    anchor: "center center",
    blur: 0,
    editorFill: false,
    editorOpacity: 80,
    sidebarFill: true,
    sidebarOpacity: 100,
};

/** A stored switch, or the default when what is stored is not a boolean (absent, or hand-edited). */
function readSwitch(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function readPlateOpacity(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0
        ? Math.min(BACKGROUND_PLATE_OPACITY_MAX, Math.max(BACKGROUND_PLATE_OPACITY_MIN, Math.round(numeric)))
        : fallback;
}

/** Normalize whatever is stored (older installs predate fill/anchor/blur) into a complete settings object. */
export function readBackgroundSettings(get: (key: string) => unknown): BackgroundSettings {
    const image = get(BACKGROUND_KEYS.image);
    const opacity = Number(get(BACKGROUND_KEYS.opacity));
    const fill = get(BACKGROUND_KEYS.fill);
    const anchor = get(BACKGROUND_KEYS.anchor);
    const blur = Number(get(BACKGROUND_KEYS.blur));
    return {
        image: typeof image === "string" && image.length > 0 ? image : null,
        opacity: Number.isFinite(opacity) && opacity > 0 ? Math.min(40, Math.max(2, opacity)) : DEFAULT_BACKGROUND.opacity,
        fill: BACKGROUND_FILLS.includes(fill as BackgroundFill) ? (fill as BackgroundFill) : DEFAULT_BACKGROUND.fill,
        anchor: BACKGROUND_ANCHORS.includes(anchor as BackgroundAnchor)
            ? (anchor as BackgroundAnchor)
            : DEFAULT_BACKGROUND.anchor,
        // 0 is a legitimate value here, so this checks finiteness rather than truthiness.
        blur: Number.isFinite(blur) ? Math.min(BACKGROUND_BLUR_MAX, Math.max(0, blur)) : DEFAULT_BACKGROUND.blur,
        editorFill: readSwitch(get(BACKGROUND_KEYS.editorFill), DEFAULT_BACKGROUND.editorFill),
        editorOpacity: readPlateOpacity(get(BACKGROUND_KEYS.editorOpacity), DEFAULT_BACKGROUND.editorOpacity),
        sidebarFill: readSwitch(get(BACKGROUND_KEYS.sidebarFill), DEFAULT_BACKGROUND.sidebarFill),
        sidebarOpacity: readPlateOpacity(get(BACKGROUND_KEYS.sidebarOpacity), DEFAULT_BACKGROUND.sidebarOpacity),
    };
}

/**
 * A plate's alpha as the custom property carries it: `"0"` with the plate off, and exactly `"1"` at
 * the top of the slider, so a plate the author asked to be solid carries no faint wash of the
 * picture behind it.
 */
export function backgroundPlateAlpha(on: boolean, opacity: number): string {
    if (!on) {
        return "0";
    }
    return opacity >= BACKGROUND_PLATE_OPACITY_MAX ? "1" : String(opacity / 100);
}

/** Both plate properties, for the workspace root's inline style. */
export function backgroundPlateStyle(settings: BackgroundSettings): Record<string, string> {
    return {
        [BACKGROUND_EDITOR_ALPHA_VAR]: backgroundPlateAlpha(settings.editorFill, settings.editorOpacity),
        [BACKGROUND_SIDEBAR_ALPHA_VAR]: backgroundPlateAlpha(settings.sidebarFill, settings.sidebarOpacity),
    };
}

/**
 * How far the painted layer overhangs the window on every side. `filter: blur()` samples the
 * transparent pixels outside an element, so a layer that stops at the window edge fades out along
 * it; growing the layer past the edge (and clipping it) keeps the blur even. Two radii is where
 * the Gaussian tail has effectively died out.
 */
export function backgroundBleed(settings: BackgroundSettings): number {
    return settings.blur > 0 ? settings.blur * 2 : 0;
}

/**
 * One axis of `background-position`, corrected for the bleed so growing the layer does not drag
 * the picture with it: edge keywords become an explicit offset, `center` stays centred because
 * the overhang is symmetric.
 */
function anchorAxis(keyword: string, bleed: number): string {
    if (bleed === 0) {
        return keyword;
    }
    switch (keyword) {
        case "left":
        case "top":
            return `${bleed}px`;
        case "right":
        case "bottom":
            return `calc(100% - ${bleed}px)`;
        default:
            return "center";
    }
}

/** CSS for the overlay layer: `background-size` / `background-repeat` / `background-position` / blur. */
export function backgroundLayerStyle(settings: BackgroundSettings, url: string): React.CSSProperties {
    const bleed = backgroundBleed(settings);
    const [horizontal, vertical] = settings.anchor.split(" ");
    const common: React.CSSProperties = {
        backgroundImage: `url(${url})`,
        backgroundPosition: `${anchorAxis(horizontal, bleed)} ${anchorAxis(vertical, bleed)}`,
        opacity: Math.min(0.4, Math.max(0.02, settings.opacity / 100)),
        inset: `-${bleed}px`,
        filter: settings.blur > 0 ? `blur(${settings.blur}px)` : undefined,
    };
    switch (settings.fill) {
        case "cover":
            return { ...common, backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
        case "contain":
            return { ...common, backgroundSize: "contain", backgroundRepeat: "no-repeat" };
        case "tile":
            return {
                ...common,
                backgroundSize: "auto",
                backgroundRepeat: "repeat",
                backgroundPosition: `${anchorAxis("left", bleed)} ${anchorAxis("top", bleed)}`,
            };
        case "center":
            return { ...common, backgroundSize: "auto", backgroundRepeat: "no-repeat" };
    }
}
