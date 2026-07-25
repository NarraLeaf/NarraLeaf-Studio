import { useSyncExternalStore } from "react";
import { isReduceMotionEnabled, subscribeReduceMotion } from "./index";

/**
 * Whether the `ui.reduceMotion` setting is on, as a subscription.
 *
 * CSS already stops transitions and animations wholesale (`.nl-reduce-motion` in styles.css), so
 * reach for this hook only when a component has to make a *structural* choice the stylesheet cannot
 * express — dropping work rather than dropping animation. The story editor's background rows use it
 * to skip decoding a photograph per row.
 *
 * Not the OS preference: that one is answered by `prefers-reduced-motion` in CSS, and mirroring a
 * media query in JS is how the theme layer broke once before (see `isReduceMotionEnabled`).
 */
export function useReduceMotion(): boolean {
    return useSyncExternalStore(subscribeReduceMotion, isReduceMotionEnabled, isReduceMotionEnabled);
}
