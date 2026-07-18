/**
 * The custom-background settings, shared by the dialog that edits them and the layer that paints
 * them. All four live in global state so every window repaints together; the workspace is the only
 * writer, and the Settings window just asks it to open the dialog.
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

export interface BackgroundSettings {
    /** File name inside userData/backgrounds, or null when no background is set. */
    image: string | null;
    /** Percent, 2–40: watermark strength. */
    opacity: number;
    fill: BackgroundFill;
    anchor: BackgroundAnchor;
}

export const BACKGROUND_KEYS: Record<keyof BackgroundSettings, string> = {
    image: "ui.backgroundImage",
    opacity: "ui.backgroundOpacity",
    fill: "ui.backgroundFill",
    anchor: "ui.backgroundAnchor",
};

export const DEFAULT_BACKGROUND: BackgroundSettings = {
    image: null,
    opacity: 8,
    fill: "cover",
    anchor: "center center",
};

/** Normalize whatever is stored (older projects predate fill/anchor) into a complete settings object. */
export function readBackgroundSettings(get: (key: string) => unknown): BackgroundSettings {
    const image = get(BACKGROUND_KEYS.image);
    const opacity = Number(get(BACKGROUND_KEYS.opacity));
    const fill = get(BACKGROUND_KEYS.fill);
    const anchor = get(BACKGROUND_KEYS.anchor);
    return {
        image: typeof image === "string" && image.length > 0 ? image : null,
        opacity: Number.isFinite(opacity) && opacity > 0 ? Math.min(40, Math.max(2, opacity)) : DEFAULT_BACKGROUND.opacity,
        fill: BACKGROUND_FILLS.includes(fill as BackgroundFill) ? (fill as BackgroundFill) : DEFAULT_BACKGROUND.fill,
        anchor: BACKGROUND_ANCHORS.includes(anchor as BackgroundAnchor)
            ? (anchor as BackgroundAnchor)
            : DEFAULT_BACKGROUND.anchor,
    };
}

/** CSS for the overlay layer: `background-size` / `background-repeat` / `background-position`. */
export function backgroundLayerStyle(settings: BackgroundSettings, url: string): React.CSSProperties {
    const common = {
        backgroundImage: `url(${url})`,
        backgroundPosition: settings.anchor,
        opacity: Math.min(0.4, Math.max(0.02, settings.opacity / 100)),
    };
    switch (settings.fill) {
        case "cover":
            return { ...common, backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
        case "contain":
            return { ...common, backgroundSize: "contain", backgroundRepeat: "no-repeat" };
        case "tile":
            return { ...common, backgroundSize: "auto", backgroundRepeat: "repeat", backgroundPosition: "left top" };
        case "center":
            return { ...common, backgroundSize: "auto", backgroundRepeat: "no-repeat" };
    }
}
