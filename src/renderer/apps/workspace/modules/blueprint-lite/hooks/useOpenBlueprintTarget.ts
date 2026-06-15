import { useCallback } from "react";
import { useRegistry } from "@/apps/workspace/registry";
import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import { createBlueprintEntryEditorTab } from "../openBlueprintEditorTab";

/**
 * Open or focus the blueprint editor tab with a unified navigation payload.
 */
export function useOpenBlueprintTarget() {
    const { openEditorTab } = useRegistry();

    return useCallback(
        (target: BlueprintEditorOpenTarget) => {
            openEditorTab(createBlueprintEntryEditorTab(target));
        },
        [openEditorTab],
    );
}
