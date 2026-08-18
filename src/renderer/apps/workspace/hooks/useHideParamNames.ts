import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import {
  HIDE_PARAM_NAMES_DEFAULT,
  HIDE_PARAM_NAMES_KEY
} from "@/lib/settings/commandParamNameOptions";

/**
 * Reads the `editor.hideParamNames` preference — whether a committed story row prints only the values
 * of its modifiers (`@hide Anyo fade`) rather than the whole `key=value` pair (`@hide Anyo t=fade`).
 *
 * Re-reads when the window regains focus so a change made in the separate Settings window applies as
 * soon as the author returns, mirroring {@link useSlashAtAlias} (no cross-window push).
 */
export function useHideParamNames(): boolean {
  const [value, setValue] = useState(HIDE_PARAM_NAMES_DEFAULT);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await getInterface().app.state.getGlobalState(HIDE_PARAM_NAMES_KEY);
        if (cancelled) {
          return;
        }
        const stored = result.success ? result.data.value : undefined;
        setValue(typeof stored === "boolean" ? stored : HIDE_PARAM_NAMES_DEFAULT);
      } catch {
        // Keep the last known-good value on transient IPC failures.
      }
    };
    void load();
    const onFocus = () => {
      void load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return value;
}
