import { useMemo, useRef } from "react";
import type { GlobalStateKeys } from "@shared/types/state/globalState";
import { useGlobalSettings } from "./useGlobalSettings";

/**
 * One global-state preference, read once and then followed live.
 *
 * Settings is a window of its own, so every reader of a preference lives in a different window
 * from the control that changes it. The main process already closes that gap: one write path
 * (`BaseApp.setGlobalStateAndBroadcast`) pushes the new value to every open window, and a reset
 * pushes `undefined` the same way. Readers used to re-read on `window.focus` instead, which meant
 * a preference changed in Settings sat invisible until the author clicked back into the workspace
 * — appearing, if they clicked into it, under their pointer a moment later, and not at all while
 * the Settings window stayed in front.
 *
 * `resolve` turns a stored value into the one the interface uses. It has to handle `undefined`,
 * which is both what a key that was never written reads as and what a reset broadcasts — several
 * preferences (the "/" alias, the background) only reach their real fallback when nothing is
 * stored at all, so resolving is the reader's job rather than the store's.
 */
export function useGlobalSetting<T>(key: GlobalStateKeys, resolve: (stored: unknown) => T): T {
    const { values } = useGlobalSettings([key]);
    const resolveRef = useRef(resolve);
    resolveRef.current = resolve;
    const stored = values[key];
    return useMemo(() => resolveRef.current(stored), [key, stored]);
}
