import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../context";
import { HistoryService, type HistoryScope } from "@/lib/workspace/services/history/HistoryService";
import type { HistoryLabel, HistoryScopeId } from "@/lib/workspace/services/history/historyModel";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { isEditorOwnedFocus } from "@/lib/workspace/services/history/workspaceUndoTarget";
import { FocusArea, type FocusContext } from "@/lib/workspace/services/ui/types";
import { Services } from "@/lib/workspace/services/services";

/**
 * Bind an editor to its undo stack.
 *
 * The two halves an editor needs and should not have to wire twice:
 *
 *  - it *publishes* how to read and write the state it edits, for as long as it is mounted;
 *  - it *reads back* whether undo/redo are available, so a toolbar button can grey out.
 *
 * `capture` and `apply` are read through a ref, so they may close over fresh render state without
 * re-registering the scope on every keystroke - re-registering is what would reset the stack.
 *
 * Unmounting drops the registration but keeps the stack: reopening the tab picks the history back
 * up. See {@link HistoryService.registerScope}.
 */
export function useHistoryScope<S>(options: {
  /** Null while the editor does not know what it is editing yet; nothing registers. */
  scopeId: HistoryScopeId | null;
  label: HistoryLabel;
  capture: () => S | null;
  apply: (snapshot: S) => void;
  limit?: number;
  /**
   * The editor tab this scope belongs to. When given, the scope becomes the one a scope-less undo
   * acts on **while that tab has focus** - which is what makes a split view behave: two story tabs
   * are two scopes, and Ctrl+Z has to mean the one the author is looking at, not the one that
   * happened to mount last.
   */
  tabId?: string;
}) {
  const { context, isInitialized } = useWorkspace();
  const history = useMemo(
    () =>
      context && isInitialized ? context.services.get<HistoryService>(Services.History) : null,
    [context, isInitialized]
  );

  const { scopeId, label, capture, apply, limit, tabId } = options;

  const readersRef = useRef({ capture, apply, label });
  readersRef.current = { capture, apply, label };

  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!history || !scopeId) {
      return;
    }
    const scope: HistoryScope<S> = {
      id: scopeId,
      get label() {
        return readersRef.current.label;
      },
      capture: () => readersRef.current.capture(),
      apply: (snapshot) => readersRef.current.apply(snapshot),
      limit
    };
    const dispose = history.registerScope(scope);
    return () => {
      dispose();
    };
  }, [history, scopeId, limit]);

  // Claim the active scope for as long as this tab holds focus. Not on mount: two editors of the
  // same kind can be mounted at once, and only one of them is the one Ctrl+Z means.
  useEffect(() => {
    if (!history || !scopeId || !tabId || !context) {
      return;
    }
    const uiService = context.services.get<UIService>(Services.UI);
    const claim = (focus: FocusContext) => {
      if (focus.area === FocusArea.Editor && focus.targetId === tabId) {
        history.setActiveScope(scopeId);
      } else if (history.getActiveScopeId() === scopeId && !isEditorOwnedFocus(focus)) {
        // Moving into the property inspector is not leaving this editor: everything the
        // inspector writes lands in this very stack. Disowning the scope there left the
        // author's own Ctrl+Z, pressed where they had just made the edit, with nothing to
        // act on.
        history.setActiveScope(null);
      }
    };
    claim(uiService.focus.getFocus());
    const unsubscribe = uiService.focus.onFocusChange(claim);
    return () => {
      unsubscribe();
      if (history.getActiveScopeId() === scopeId) {
        history.setActiveScope(null);
      }
    };
  }, [context, history, scopeId, tabId]);

  useEffect(() => {
    if (!history || !scopeId) {
      return;
    }
    return history.on("changed", (event) => {
      if (event.scopeId === scopeId) {
        setVersion((current) => current + 1);
      }
    });
  }, [history, scopeId]);

  /** Record the state as it stands, immediately before mutating it. */
  const checkpoint = useCallback(
    (
      entryLabel: HistoryLabel,
      options?: { mergeKey?: string; mergeWindowMs?: number; before?: S }
    ): boolean => {
      if (!history || !scopeId) {
        return false;
      }
      return history.checkpoint(scopeId, { label: entryLabel, ...options });
    },
    [history, scopeId]
  );

  const undo = useCallback(
    () => (history && scopeId ? history.undo(scopeId) : false),
    [history, scopeId]
  );
  const redo = useCallback(
    () => (history && scopeId ? history.redo(scopeId) : false),
    [history, scopeId]
  );
  const clear = useCallback(() => {
    if (history && scopeId) {
      history.clearScope(scopeId);
    }
  }, [history, scopeId]);

  return useMemo(
    () => ({
      history,
      scopeId,
      checkpoint,
      undo,
      redo,
      clear,
      canUndo: !!history && !!scopeId && history.canUndo(scopeId),
      canRedo: !!history && !!scopeId && history.canRedo(scopeId)
    }),
    // `version` is the subscription: the booleans above are read imperatively, so the memo has
    // to be told when the stack moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, scopeId, checkpoint, undo, redo, clear, version]
  );
}
