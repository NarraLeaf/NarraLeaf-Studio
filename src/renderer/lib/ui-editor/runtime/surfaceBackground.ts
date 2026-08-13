import type { CSSProperties } from "react";
import { getActiveBrandPalette } from "@shared/brand/brandRegistry";
import type { UISurface } from "@shared/types/ui-editor/document";
import {
    normalizeUISurfaceBackgroundImage,
    type UISurfaceBackgroundFillMode,
    type UISurfaceBackgroundImage,
} from "@shared/types/ui-editor/surfaceBackgroundImage";

export const EDITOR_SURFACE_AREA_BACKGROUND = "#ffffff";
export const EDITOR_SURFACE_LOW_OPACITY_THRESHOLD = 0.2;
export const EDITOR_SURFACE_LOW_OPACITY_OUTLINE =
    "1px solid var(--narraleaf-accent-strong, rgba(64, 168, 196, 0.92))";

/**
 * The colour a surface paints behind everything on it, as CSS.
 *
 * Every reader in this module goes through here, which is why the brand link is resolved at this one
 * point: the value ends up interpolated into a `color-mix()` and measured by `getCssBackgroundAlpha`,
 * and neither of those can be handed an `nlbrand:` token. Resolved through the registry rather than
 * the `colorUtils` pair because those two work in `{hex, alpha}` and would flatten `transparent` and
 * every functional-notation colour an author may have typed; this keeps the stored spelling for
 * anything that is not a link.
 *
 * A link that does not resolve falls through as itself, so a broken reference paints nothing and lint
 * is the thing that explains why - rather than a colour appearing that no one chose.
 */
export function getSurfaceBackgroundColor(surface: UISurface): string {
    const stored = surface.settings?.backgroundColor ?? (surface.kind === "stageSurface" ? "transparent" : "#ffffff");
    return getActiveBrandPalette().resolveValueCss(stored) ?? stored;
}

/**
 * How much of a page's own background survives when that page is opened OVER a running game.
 *
 * A surface authored for the title menu is opaque, because behind it there is nothing to see. The
 * same surface opened mid-game as an overlay - Config, Save, Log from the quick menu - has the stage
 * behind it, and painting over it at full opacity throws away the one thing that tells the player
 * they are still in the scene.
 *
 * 0.85 rather than something bolder: the point is a reminder that the scene is still there, not a
 * view of it. At half opacity the stage competes with the page's own labels and the screen becomes
 * hard to read against a busy background; this leaves the shape of the scene showing through and
 * nothing else.
 *
 * Only the page's own background is thinned; its widgets keep their authored opacity, so labels and
 * controls stay as legible as they are anywhere else.
 */
export const GAME_OVERLAY_BACKGROUND_ALPHA = 0.85;

/**
 * The background a surface layer paints, given how it is being presented.
 *
 * `color-mix` rather than parsing: the authored value can be any CSS colour the inspector produced
 * (hex, `#rrggbbaa`, `rgb()`, `hsl()`), and mixing towards `transparent` scales whatever alpha it
 * already carries without this file having to understand the syntax. `transparent` stays transparent
 * either way, which is what a stage surface wants.
 */
export function getSurfaceLayerBackgroundColor(
    surface: UISurface,
    presentation: "appPage" | "gameOverlay",
): string {
    const color = getSurfaceBackgroundColor(surface);
    if (presentation !== "gameOverlay" || getCssBackgroundAlpha(color) <= 0) {
        return color;
    }
    return `color-mix(in srgb, ${color} ${GAME_OVERLAY_BACKGROUND_ALPHA * 100}%, transparent)`;
}

/**
 * The sheet a layer lays over everything beneath it.
 *
 * Painted behind the layer's own background rather than instead of it, so a layer that carries a
 * colour of its own keeps it and one authored transparent - the usual shape for something that floats
 * in the middle of the screen - shows the scrim alone.
 *
 * Deliberately theme-invariant, in the same class as the other dimming overlays: what it dims is the
 * author's own screen as a player will see it, and half black is dark enough that the page above it
 * separates from whatever it covers without hiding that something is still there.
 */
export const SURFACE_LAYER_SCRIM_COLOR = "color-mix(in srgb, #000000 50%, transparent)";

/**
 * How much of a page's background picture survives when the page is opened over a running game.
 *
 * The same reasoning as {@link GAME_OVERLAY_BACKGROUND_ALPHA}, and deliberately the same number: a
 * Config page reached from the quick menu has to keep the scene showing through, and an author who
 * gave that page a full-bleed picture would otherwise defeat the thinning the colour already gets.
 */
export function getSurfaceLayerBackgroundImageOpacity(
    presentation: "appPage" | "gameOverlay",
): number {
    return presentation === "gameOverlay" ? GAME_OVERLAY_BACKGROUND_ALPHA : 1;
}

export function getSurfaceBackgroundImage(surface: UISurface): UISurfaceBackgroundImage | null {
    return normalizeUISurfaceBackgroundImage(surface.settings?.backgroundImage);
}

/**
 * The CSS that draws a background picture at a given fill mode.
 *
 * A `background-image` rather than an `<img>`: `tile` is a repeat, which no single element can
 * express, and the other three are one `background-size` each. Widget fills reach for `<img>`
 * because crop mode animates its box; nothing here does.
 */
export function surfaceBackgroundImageStyle(
    url: string,
    fillMode: UISurfaceBackgroundFillMode,
): CSSProperties {
    const base: CSSProperties = {
        backgroundImage: `url("${url.replace(/["\\]/g, "\\$&")}")`,
        backgroundPosition: "center",
    };
    if (fillMode === "tile") {
        return { ...base, backgroundRepeat: "repeat", backgroundSize: "auto", backgroundPosition: "top left" };
    }
    return {
        ...base,
        backgroundRepeat: "no-repeat",
        backgroundSize: fillMode === "stretch" ? "100% 100%" : fillMode,
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function parseAlpha(value: string | undefined): number | null {
    if (value === undefined) {
        return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const alpha = trimmed.endsWith("%")
        ? Number(trimmed.slice(0, -1)) / 100
        : Number(trimmed);
    return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : null;
}

function parseFunctionalColorAlpha(value: string): number | null {
    const match = value.match(/^(?:rgb|hsl)a?\((.*)\)$/i);
    if (!match) {
        return null;
    }
    const body = match[1]?.trim() ?? "";
    if (body.includes("/")) {
        const alpha = body.split("/").pop();
        return parseAlpha(alpha);
    }
    const commaParts = body.split(",");
    if (commaParts.length >= 4) {
        return parseAlpha(commaParts[3]);
    }
    return 1;
}

export function getCssBackgroundAlpha(value: string | null | undefined): number {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized.length === 0 || normalized === "transparent") {
        return 0;
    }

    const hexBody = normalized.replace(/^#/, "");
    if (/^[0-9a-f]{4}$/.test(hexBody)) {
        return Number.parseInt(hexBody[3]!, 16) / 15;
    }
    if (/^[0-9a-f]{8}$/.test(hexBody)) {
        return Number.parseInt(hexBody.slice(6, 8), 16) / 255;
    }
    if (/^[0-9a-f]{3}$/.test(hexBody) || /^[0-9a-f]{6}$/.test(hexBody)) {
        return 1;
    }

    return parseFunctionalColorAlpha(normalized) ?? 1;
}

export function getSurfaceBackgroundAlpha(surface: UISurface): number {
    return getCssBackgroundAlpha(getSurfaceBackgroundColor(surface));
}

function isTransparentBackground(value: string | null | undefined): boolean {
    return getCssBackgroundAlpha(value) <= 0;
}

export function getEditorSurfaceAreaBackgroundColor(surface: UISurface): string | undefined {
    if (surface.kind !== "stageSurface") {
        return undefined;
    }
    // Through `getSurfaceBackgroundColor` rather than off `settings` directly, so a linked colour is
    // measured as the colour it resolves to. Reading the raw field would see an unparseable string,
    // and `getCssBackgroundAlpha` calls that opaque - the checkerboard would vanish under a link.
    return isTransparentBackground(getSurfaceBackgroundColor(surface)) ? EDITOR_SURFACE_AREA_BACKGROUND : undefined;
}

export function shouldShowEditorSurfaceLowOpacityOutline(surface: UISurface): boolean {
    return getSurfaceBackgroundAlpha(surface) < EDITOR_SURFACE_LOW_OPACITY_THRESHOLD;
}
