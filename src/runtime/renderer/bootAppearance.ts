/**
 * The two colours a game waits in.
 *
 * The background is not this file's answer: the desktop shell already painted its window the entry
 * screen's colour before this document existed, and the web export bakes the same value into the
 * page it generates - see `resolveGameRuntimeInitialBackgroundColor`, which both of them call. So
 * the loading state asks that same function rather than deciding for itself, and the reveal is the
 * interface appearing rather than the window changing colour. A second rule here would show as a
 * flash on exactly the projects the shared one exists for.
 *
 * Comments in English per project convention.
 */
import { accentForeground } from "@shared/constants/accent";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { resolveGameRuntimeInitialBackgroundColor } from "@shared/utils/gameRuntimeEntrySurface";

/**
 * What is painted before the pack has said anything.
 *
 * Nothing, deliberately: the window under this document is already the right colour, and covering
 * it with a guess would be a frame of one colour between two frames of another - which is what the
 * bare black div this replaced did on every light game.
 */
export const RUNTIME_BOOT_FALLBACK_BACKGROUND = "transparent";
/** The indicator's colour over that unknown background. Wrong only for the instant a pack takes. */
export const RUNTIME_BOOT_FALLBACK_ACCENT = "rgb(255 255 255)";

export type RuntimeBootColors = {
    background: string;
    accent: string;
};

/**
 * What to paint while the game starts.
 *
 * The indicator is the ink the design system puts on that background rather than a colour from the
 * project's palette. A palette colour can be anything, including the background itself - and the
 * one thing this mark has to do is be visible, on a game whose title screen is white as much as on
 * one whose title screen is black.
 */
export function resolveRuntimeBootColors(pack: GameRuntimePackV1 | null): RuntimeBootColors {
    if (!pack) {
        return { background: RUNTIME_BOOT_FALLBACK_BACKGROUND, accent: RUNTIME_BOOT_FALLBACK_ACCENT };
    }
    const background = resolveGameRuntimeInitialBackgroundColor(pack);
    return { background, accent: `rgb(${accentForeground(background)})` };
}
