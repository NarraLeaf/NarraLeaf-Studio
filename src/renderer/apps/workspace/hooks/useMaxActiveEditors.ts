import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { clampMaxActiveEditors, MAX_ACTIVE_EDITORS_DEFAULT } from "@/lib/settings/editorLayoutOptions";

/**
 * Reads the `editor.maxActiveEditors` preference - how many editor tabs an {@link EditorGroup}
 * keeps mounted (kept alive) at once so their scroll position and focus survive a tab switch.
 *
 * Re-reads when the window regains focus so a change made in the separate Settings window applies
 * as soon as the author returns, mirroring `StoryEditorTextStyleProvider` (no cross-window push).
 */
export function useMaxActiveEditors(): number {
    const [value, setValue] = useState(MAX_ACTIVE_EDITORS_DEFAULT);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const result = await getInterface().app.state.getGlobalState("editor.maxActiveEditors");
                if (cancelled) {
                    return;
                }
                setValue(clampMaxActiveEditors(result.success ? result.data.value : undefined));
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
