import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DetachedWindow } from "@/lib/components/layout";
import { getInterface } from "@/lib/app/bridge";
import {
  DETACHED_EDITOR_ON_CLOSE_DEFAULT,
  DETACHED_EDITOR_ON_CLOSE_KEY,
  resolveDetachedEditorOnClose,
  type DetachedEditorOnClose
} from "@/lib/settings/detachedEditorCloseOptions";
import { useTranslation } from "@/lib/i18n";
import { BlueprintEntryTab } from "../modules/blueprint-lite/editors/BlueprintEntryTab";
import { useOpenBlueprintTarget } from "../modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import {
  readDetachedEditors,
  releaseDetachedEditor,
  subscribeDetachedEditors,
  type DetachedEditor
} from "./detachedEditors";

/**
 * Every editor currently living in a window of its own.
 *
 * Mounted once, high in the workspace tree and outside the editor area, because that is what lets
 * a detached editor outlive the tab it came from: popping out closes the tab, which unmounts
 * everything under it, and an editor whose window contents unmount is an empty window. From here
 * the editor is portalled into its own window (see `DetachedWindow`) while staying inside every
 * provider the workspace has - the same services, the same document, the same undo stack.
 */
export function DetachedEditorsHost() {
  const entries = useSyncExternalStore(subscribeDetachedEditors, readDetachedEditors);
  const onCloseBehavior = useDetachedEditorOnClose();
  const openBlueprint = useOpenBlueprintTarget();
  const { t } = useTranslation();

  // Read at close time, not at render time: the author can change the setting in the separate
  // Settings window while the detached editor is open, and the answer that matters is the one in
  // force when the window actually closes.
  const behaviorRef = useRef<DetachedEditorOnClose>(onCloseBehavior);
  behaviorRef.current = onCloseBehavior;

  const onWindowClosed = useCallback(
    (entry: DetachedEditor) => {
      if (!releaseDetachedEditor(entry.tabId)) {
        return;
      }
      if (behaviorRef.current !== "restoreTab") {
        return;
      }
      openBlueprint({
        blueprintId: entry.payload.blueprintId,
        ownerKind: entry.payload.ownerKind,
        surfaceId: entry.payload.surfaceId,
        componentId: entry.payload.componentId,
        elementId: entry.payload.elementId,
        propPath: entry.payload.propPath,
        title: entry.tabTitle
      });
    },
    [openBlueprint, t]
  );

  return (
    <>
      {entries.map((entry) => (
        <DetachedWindow
          key={entry.tabId}
          windowKey={entry.tabId}
          title={entry.title}
          onClosed={() => onWindowClosed(entry)}
        >
          <BlueprintEntryTab tabId={entry.tabId} payload={entry.payload} active />
        </DetachedWindow>
      ))}
    </>
  );
}

/**
 * The `editor.detachedEditorOnClose` preference.
 *
 * Re-read when this window regains focus, the way `useMaxActiveEditors` does: the setting lives in
 * a separate Settings window and nothing pushes it across.
 */
function useDetachedEditorOnClose(): DetachedEditorOnClose {
  const [value, setValue] = useState<DetachedEditorOnClose>(DETACHED_EDITOR_ON_CLOSE_DEFAULT);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await getInterface().app.state.getGlobalState(DETACHED_EDITOR_ON_CLOSE_KEY);
        if (cancelled) {
          return;
        }
        setValue(resolveDetachedEditorOnClose(result.success ? result.data.value : undefined));
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
