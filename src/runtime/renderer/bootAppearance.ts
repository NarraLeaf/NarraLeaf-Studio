/**
 * The two colours a game waits in.
 *
 * A loading state has to be painted before there is anything of the game to look at, and until this
 * existed the answer was black - which is a colour no author picked and which almost never matches
 * what arrives a second later. The pack already carries the project's palette (it is published to
 * the brand registry before the first render, see `useRuntimePack`), so the wait can be painted in
 * the game's own colours and the reveal becomes the interface appearing rather than the window
 * changing colour.
 *
 * Comments in English per project convention.
 */
import { resolveBrandColorValue } from "@shared/brand/brandRegistry";
import type { UISurface } from "@shared/types/ui-editor/document";
import { getCssBackgroundAlpha, getSurfaceBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";

/** Where a project says nothing at all - no pack yet, or a palette that resolves to nothing. */
export const RUNTIME_BOOT_FALLBACK_BACKGROUND = "#000000";
export const RUNTIME_BOOT_FALLBACK_ACCENT = "#ffffff";

export type RuntimeBootColors = {
    background: string;
    accent: string;
};

/**
 * What to paint while the game starts, given the screen it is starting towards.
 *
 * The entry surface's own background first, because that is literally the colour the player is
 * about to be shown: matching it means the loading state and the title screen are one continuous
 * picture. A surface authored transparent (or a pack not read yet) has no such colour, and the
 * project's `background` is the palette's own answer to "what is behind this game" - every seeded
 * project has one, and a project that changed it changed this with it.
 *
 * The accent is `foreground` for the reason it exists: it is the colour the palette declares as
 * legible against `background`. Reaching for white instead would be an indicator invisible on every
 * pale game.
 */
export function resolveRuntimeBootColors(entrySurface: UISurface | null): RuntimeBootColors {
    const surfaceColor = entrySurface ? getSurfaceBackgroundColor(entrySurface) : null;
    const background = surfaceColor && getCssBackgroundAlpha(surfaceColor) > 0
        ? surfaceColor
        : resolveBrandColorValue("nlbrand:background") ?? RUNTIME_BOOT_FALLBACK_BACKGROUND;
    const accent = resolveBrandColorValue("nlbrand:foreground") ?? RUNTIME_BOOT_FALLBACK_ACCENT;
    return { background, accent };
}
