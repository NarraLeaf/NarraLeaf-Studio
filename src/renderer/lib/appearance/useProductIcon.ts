import { useSyncExternalStore } from "react";
import { getProductIconSrc, isProductIconDefault, subscribeProductIcon } from "./index";

/**
 * The URL of the mark the interface should be drawing, as a subscription.
 *
 * Every logo surface reads it from here rather than hard-coding `/favicon.ico`, which is what let
 * the title bar and the taskbar disagree: ten call sites each spelled the path out, so there was
 * nowhere for the preference to land.
 *
 * Safe before `initAppearance` has run and safe in the crash screens: the module starts out
 * holding the shipped mark, so the worst case is a window that shows the leaf.
 */
export function useProductIconSrc(): string {
    return useSyncExternalStore(subscribeProductIcon, getProductIconSrc, getProductIconSrc);
}

/** Whether the current mark is the flat silhouette the watermark is allowed to mask. */
export function useProductIconIsDefault(): boolean {
    return useSyncExternalStore(subscribeProductIcon, isProductIconDefault, isProductIconDefault);
}
