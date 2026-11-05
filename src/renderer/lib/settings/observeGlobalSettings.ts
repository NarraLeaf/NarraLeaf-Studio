import { getInterface } from "@/lib/app/bridge";
import type { GlobalStateKeys } from "@shared/types/state/globalState";

/** Subscribe before reading; broadcasts take precedence over each key's initial answer. */
export function observeGlobalSettings(
    keys: readonly GlobalStateKeys[],
    receive: (key: GlobalStateKeys, value: unknown) => void,
): { ready: Promise<void>; dispose(): void } {
    const wanted = new Set(keys);
    const pushed = new Set<GlobalStateKeys>();
    let disposed = false;
    const state = getInterface().app.state;
    const token = state.onGlobalStateChanged?.(change => {
        if (disposed || !wanted.has(change.key)) return;
        pushed.add(change.key);
        receive(change.key, change.value);
    });
    const ready = Promise.all([...wanted].map(async key => {
        try {
            const answer = await state.getGlobalState(key);
            if (!disposed && !pushed.has(key) && answer.success) {
                receive(key, answer.data.value);
            }
        } catch {
            // Readers retain their last value when the bridge is unavailable.
        }
    })).then(() => undefined);
    return {
        ready,
        dispose: () => { disposed = true; token?.cancel(); },
    };
}
