import { BrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";

/**
 * Entry-surface lookups shared by the runtime shells: the desktop shell sizes
 * and colors its BrowserWindow from these before first paint, and the web
 * export bakes the same values into its generated index.html - so both shells
 * show an identical pre-boot frame for the same pack.
 */

export function resolveGameRuntimeEntrySurface(pack: GameRuntimePackV1) {
  const surfaceId = pack.entry.kind === "surface" ? pack.entry.surfaceId : null;
  return surfaceId
    ? pack.bundle.ui.uidoc.surfaces.find((item) => item.id === surfaceId)
    : pack.bundle.ui.uidoc.surfaces.find((item) => item.kind === "appSurface");
}

/**
 * The shell background is visible until the renderer's first paint, so it
 * should match the entry surface instead of flashing black under a light UI.
 * Mirrors the renderer's surface background defaults: app surfaces are white
 * unless configured, stage surfaces are transparent - which has no opaque
 * equivalent and falls back to black, as does anything unparseable.
 *
 * A configured colour is resolved through the pack's brand palette first,
 * because "unparseable" would otherwise include every `nlbrand:` link - and
 * the visible result of that is precisely the flash this function exists to
 * prevent, on the projects most likely to hit it (an author who set the entry
 * surface to the brand background is an author with a light game).
 */
export function resolveGameRuntimeInitialBackgroundColor(pack: GameRuntimePackV1): string {
  const surface = resolveGameRuntimeEntrySurface(pack);
  const configured = surface?.settings?.backgroundColor;
  if (typeof configured === "string" && configured.trim()) {
    return normalizeOpaqueBackgroundColor(resolvePackBrandValue(pack, configured)) ?? "#000000";
  }
  return surface?.kind === "appSurface" ? "#ffffff" : "#000000";
}

/**
 * A stored colour with its brand link followed, or the string unchanged when it is not a link.
 *
 * **A local palette, not the module-level active one.** Every caller of this file runs in a MAIN
 * process - the desktop shell sizing its BrowserWindow, the packaged runtime's own main, the web
 * exporter writing index.html - where reading a pack must not publish anything: `setActiveBrandPalette`
 * is global state, and a build of one project would leave its colours standing for whatever ran
 * next. Resolving a colour is a read, so it is written as one.
 *
 * `resolveValueCss` takes the whole stored value, which is the point: the pre-boot frame, the canvas
 * and the shipped game's first painted frame all ask the same method the same question, so
 * `nlbrand:primary/0.5` cannot mean one opacity here and another one there.
 *
 * A link that resolves to nothing (an id the palette lost, a ring) comes back unchanged and goes on
 * to fail `normalizeOpaqueBackgroundColor` exactly as it did before this existed, landing on the
 * same fallback. A pack with no `brand` - one built before the feature - reads the seeds, which is
 * the palette its project would have had.
 */
function resolvePackBrandValue(pack: GameRuntimePackV1, value: string): string {
  const palette = new BrandPalette(pack.bundle.brand ?? BUILTIN_BRAND_COLORS);
  return palette.resolveValueCss(value) ?? value;
}

/**
 * Normalize a CSS color to an opaque form both BrowserWindow and inline CSS
 * accept, or null. The output is always a `#rrggbb` hex or a bare lowercase
 * color name, so it is safe to interpolate into generated markup.
 */
export function normalizeOpaqueBackgroundColor(value: string): string | null {
  const color = value.trim().toLowerCase();
  if (!color || color === "transparent") {
    return null;
  }
  const hex = /^#([0-9a-f]{3,8})$/.exec(color)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      if (hex.length === 4 && hex[3] === "0") {
        return null;
      }
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    if (hex.length === 6) {
      return `#${hex}`;
    }
    if (hex.length === 8) {
      // Fully transparent falls through to the default; a translucent
      // color keeps its RGB channels (the shell cannot blend anyway).
      return hex.slice(6) === "00" ? null : `#${hex.slice(0, 6)}`;
    }
    return null;
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(color);
  if (fn) {
    const parts = (fn[1] ?? "").split(",").map((part) => Number(part.trim()));
    const [r, g, b, a] = parts;
    if (parts.length < 3 || [r, g, b].some((channel) => !Number.isFinite(channel))) {
      return null;
    }
    if (parts.length >= 4 && !(Number.isFinite(a) && a! > 0)) {
      return null;
    }
    const toHex = (channel: number) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0");
    return `#${toHex(r!)}${toHex(g!)}${toHex(b!)}`;
  }
  // Named CSS colors pass through; the consumer resolves them natively.
  return /^[a-z]+$/.test(color) ? color : null;
}
