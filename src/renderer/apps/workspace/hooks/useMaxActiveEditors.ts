import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import { clampMaxActiveEditors } from "@/lib/settings/editorLayoutOptions";

/**
 * Reads the `editor.maxActiveEditors` preference - how many editor tabs an {@link EditorGroup}
 * keeps mounted (kept alive) at once so their scroll position and focus survive a tab switch.
 *
 * Follows the global-state broadcast, so a change made in the separate Settings window applies to
 * the open groups at once (see {@link useGlobalSetting}).
 */
export function useMaxActiveEditors(): number {
    return useGlobalSetting("editor.maxActiveEditors", clampMaxActiveEditors);
}
