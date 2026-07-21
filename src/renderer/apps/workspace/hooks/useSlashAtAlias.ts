import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { SLASH_AT_ALIAS_KEY, slashAtAliasDefault } from "@/lib/settings/slashAliasOptions";

/**
 * Reads the `editor.slashAtAlias` preference - whether "@" opens the story editor's action creator
 * alongside "/". Unset (the user never touched it) resolves to {@link slashAtAliasDefault}: on for a
 * Simplified-Chinese device, where the "/" key types "、", off otherwise.
 *
 * Re-reads when the window regains focus so a change made in the separate Settings window applies as
 * soon as the author returns, mirroring {@link useMaxActiveEditors} (no cross-window push).
 */
export function useSlashAtAlias(): boolean {
    const [value, setValue] = useState(slashAtAliasDefault);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const result = await getInterface().app.state.getGlobalState(SLASH_AT_ALIAS_KEY);
                if (cancelled) {
                    return;
                }
                const stored = result.success ? result.data.value : undefined;
                setValue(typeof stored === "boolean" ? stored : slashAtAliasDefault());
            } catch {
                // Keep the last known-good value on transient IPC failures.
            }
        };
        void load();
        const onFocus = () => { void load(); };
        window.addEventListener("focus", onFocus);
        return () => {
            cancelled = true;
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    return value;
}
