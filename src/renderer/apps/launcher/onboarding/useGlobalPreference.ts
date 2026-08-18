import { useCallback, useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";

/**
 * One global-state preference, read once and then followed.
 *
 * Local to the setup flow rather than a shared hook: this is the third or fourth surface in the
 * product to read a preference directly, and each of the others has a reason to do it its own way
 * (the settings window edits a whole registry at once, the appearance bootstrap runs before React
 * exists). Lifting this into `lib` would mean claiming it fits all of them.
 *
 * Optimistic on write, corrected by the broadcast: the main process echoes every change back, so
 * a rejected write puts the control back where it belongs rather than leaving it lying.
 */
export function useGlobalPreference<K extends GlobalStateKeys>(
  key: K,
  fallback: GlobalStateValue<K>
): [GlobalStateValue<K>, (next: GlobalStateValue<K>) => void] {
  const [value, setValue] = useState<GlobalStateValue<K>>(fallback);

  useEffect(() => {
    let alive = true;
    void getInterface()
      .app.state.getGlobalState(key)
      .then((result) => {
        if (alive && result.success && result.data.value !== undefined) {
          setValue(result.data.value as GlobalStateValue<K>);
        }
      })
      .catch(() => undefined);

    const token = getInterface().app.state.onGlobalStateChanged?.((change) => {
      if (change.key === key) {
        // An unset key broadcasts `undefined`; every reader resolves that to its default.
        setValue((change.value ?? fallback) as GlobalStateValue<K>);
      }
    });

    return () => {
      alive = false;
      token?.cancel();
    };
  }, [key, fallback]);

  const write = useCallback(
    (next: GlobalStateValue<K>) => {
      setValue(next);
      void getInterface().app.state.setGlobalState(key, next);
    },
    [key]
  );

  return [value, write];
}
