import { useCallback } from "react";
import { useRegistry } from "@/apps/workspace/registry";
import { useDetachBlueprintEditor } from "@/apps/workspace/detached/detachBlueprintEditor";
import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import { createBlueprintEntryEditorTab, showBlueprintEntryEditorTab } from "../openBlueprintEditorTab";

export type BlueprintOpenOptions = {
    /**
     * Open in a window of its own instead of a workspace tab.
     *
     * Every blueprint entry offers this on a right click, so the option is threaded through the
     * entries rather than decided by each of them.
     */
    inOwnWindow?: boolean;
    /**
     * Whether the tab is a preview - one the next blueprint opened in that pane takes over.
     *
     * Defaults to true, because every way into a blueprint is a piece of navigation: a logic card
     * in the inspector, a diagnostic, a pin on another graph. Reading three of them in a row should
     * cost one tab, and the moment the author edits one it stops being a preview by itself.
     * Callers that open a blueprint they have just *made* pass false - creating it was the intent
     * a preview tab is waiting for.
     */
    preview?: boolean;
};

/**
 * Open or focus the blueprint editor tab with a unified navigation payload.
 */
export function useOpenBlueprintTarget() {
    const { openEditorTab } = useRegistry();
    const detachBlueprint = useDetachBlueprintEditor();

    return useCallback(
        (target: BlueprintEditorOpenTarget, options?: BlueprintOpenOptions) => {
            if (options?.inOwnWindow) {
                detachBlueprint(target);
                return;
            }

            // Already open in a window of its own, the window is navigated instead of a tab opened.
            showBlueprintEntryEditorTab(
                { ...createBlueprintEntryEditorTab(target), preview: options?.preview ?? true },
                openEditorTab,
            );
        },
        [detachBlueprint, openEditorTab],
    );
}
