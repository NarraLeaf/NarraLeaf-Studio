import { useCallback } from "react";
import { useRegistry } from "@/apps/workspace/registry";
import { focusDetachedWindow } from "@/lib/components/layout";
import {
  isEditorDetached,
  releaseDetachedEditor,
  updateDetachedEditorPayload
} from "@/apps/workspace/detached/detachedEditors";
import { useDetachBlueprintEditor } from "@/apps/workspace/detached/detachBlueprintEditor";
import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import { createBlueprintEntryEditorTab } from "../openBlueprintEditorTab";

export type BlueprintOpenOptions = {
  /**
   * Open in a window of its own instead of a workspace tab.
   *
   * Every blueprint entry offers this on a right click, so the option is threaded through the
   * entries rather than decided by each of them.
   */
  inOwnWindow?: boolean;
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

      const tab = createBlueprintEntryEditorTab(target);

      // Already open in a window of its own: navigate THAT copy. Opening a tab as well
      // would leave two editors on one blueprint, and the one the author was sent to - the
      // node a diagnostic named, the graph a widget linked to - would be in the other one.
      if (tab.payload && isEditorDetached(tab.id)) {
        updateDetachedEditorPayload(tab.id, tab.payload);
        if (focusDetachedWindow(tab.id)) {
          return;
        }
        // The window went away without saying so. Fall through and dock it again rather
        // than navigate into nothing.
        releaseDetachedEditor(tab.id);
      }

      openEditorTab(tab);
    },
    [detachBlueprint, openEditorTab]
  );
}
