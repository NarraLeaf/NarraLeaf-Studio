import { useEffect, useRef, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { GlobalStateKeys } from "@shared/types/state/globalState";

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
    // Held in a ref so an inline resolver does not re-subscribe on every render. What it resolves
    // is a function of the stored value alone, so the latest one is always the right one to use.
    const resolveRef = useRef(resolve);
    resolveRef.current = resolve;

    const [value, setValue] = useState<T>(() => resolve(undefined));

    useEffect(() => {
        let cancelled = false;
        let pushed = false;

        // Subscribed before the read, not after: a change that lands while the read is in flight
        // would otherwise reach nobody, and the window would keep showing the previous value.
        const token = getInterface().app.state.onGlobalStateChanged?.((change) => {
            if (change.key !== key) {
                return;
            }
            pushed = true;
            setValue(() => resolveRef.current(change.value));
        });

        void (async () => {
            try {
                const result = await getInterface().app.state.getGlobalState(key);
                // A broadcast that arrived first is newer than what this read returns.
                if (!cancelled && !pushed) {
                    setValue(() => resolveRef.current(result.success ? result.data.value : undefined));
                }
            } catch {
                // Keep the last known-good value on transient IPC failures.
            }
        })();

        return () => {
            cancelled = true;
            token?.cancel();
        };
    }, [key]);

    return value;
}
