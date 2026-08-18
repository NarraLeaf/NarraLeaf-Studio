import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlueprintEntryTabPayload } from "../blueprintEntryTabId";

export type BlueprintEditorGraphView =
  | { kind: "event"; graphId: string }
  | { kind: "function"; graphId: string };

export type BlueprintEditorMemberFocus =
  | { kind: "graph"; view: BlueprintEditorGraphView }
  | { kind: "field"; fieldId: string }
  | { kind: "variable"; variableId: string }
  | { kind: "binding"; bindingId: string }
  | { kind: "none" };

export type BlueprintEditorState = {
  graphView: BlueprintEditorGraphView | null;
  memberFocus: BlueprintEditorMemberFocus;
  selectedNodeIds: string[];
  setGraphView: (view: BlueprintEditorGraphView | null) => void;
  setMemberFocus: (f: BlueprintEditorMemberFocus) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  selectEventGraph: (eventId: string) => void;
  selectFunctionGraph: (functionId: string) => void;
  selectField: (fieldId: string) => void;
  selectVariable: (variableId: string) => void;
  selectBinding: (bindingId: string) => void;
  applyDiagnosticTarget: (target: {
    kind: "graph" | "node" | "binding" | "field";
    graphKind?: "event" | "function";
    graphId?: string;
    nodeId?: string;
    fieldId?: string;
    bindingId?: string;
  }) => void;
};

export function useBlueprintEditorState(
  payload: BlueprintEntryTabPayload,
  lists: { eventIds: string[]; functionIds: string[] }
): BlueprintEditorState {
  const [graphView, setGraphView] = useState<BlueprintEditorGraphView | null>(null);
  const [memberFocus, setMemberFocus] = useState<BlueprintEditorMemberFocus>({ kind: "none" });
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const focusEventId =
    payload.focusEventId && lists.eventIds.includes(payload.focusEventId)
      ? payload.focusEventId
      : undefined;
  const focusFunctionId =
    payload.focusFunctionId && lists.functionIds.includes(payload.focusFunctionId)
      ? payload.focusFunctionId
      : undefined;

  const explicitFocus = useMemo(
    () => Boolean(payload.focusFieldId || focusEventId || focusFunctionId),
    [focusEventId, focusFunctionId, payload.focusFieldId]
  );

  /** Read inside {@link applyGraphFocus}, which must not re-run every time the view moves. */
  const graphViewRef = useRef(graphView);
  graphViewRef.current = graphView;

  /**
   * Take the editor to the graph the payload names.
   *
   * Does nothing when the editor is already there and the payload names no node, because this
   * routine does not only ever run on open: `BlueprintEntryTab` writes the graph an author
   * navigates to back into the tab payload (so the tab reopens where it was left), which lands
   * here as a fresh focus request one commit later. Re-applying a graph the editor is already
   * showing is not a harmless no-op — it would reset the selection, and the selection at that
   * moment may be the node the navigation was FOR: clicking a diagnostic that names a node in
   * another graph arrived with the graph switched and nothing selected.
   */
  const applyGraphFocus = useCallback(
    (view: BlueprintEditorGraphView, focusNodeId: string | undefined) => {
      const current = graphViewRef.current;
      if (!focusNodeId && current?.kind === view.kind && current.graphId === view.graphId) {
        return;
      }
      setGraphView(view);
      setMemberFocus({ kind: "graph", view });
      setSelectedNodeIds(focusNodeId ? [focusNodeId] : []);
    },
    []
  );

  const applyPayloadFocus = useCallback(() => {
    if (payload.focusFieldId) {
      setMemberFocus({ kind: "field", fieldId: payload.focusFieldId });
      setSelectedNodeIds([]);
      return;
    }
    if (focusFunctionId) {
      applyGraphFocus({ kind: "function", graphId: focusFunctionId }, payload.focusNodeId);
      return;
    }
    if (focusEventId) {
      applyGraphFocus({ kind: "event", graphId: focusEventId }, payload.focusNodeId);
      return;
    }
    setMemberFocus({ kind: "none" });
    setSelectedNodeIds([]);
  }, [applyGraphFocus, focusEventId, focusFunctionId, payload.focusFieldId, payload.focusNodeId]);

  useEffect(() => {
    applyPayloadFocus();
  }, [applyPayloadFocus]);

  // When navigating to a field only, show a graph canvas context without stealing inspector focus.
  useEffect(() => {
    if (!payload.focusFieldId) {
      return;
    }
    if (graphView !== null) {
      return;
    }
    if (lists.eventIds.length > 0) {
      setGraphView({ kind: "event", graphId: lists.eventIds[0]! });
    } else if (lists.functionIds.length > 0) {
      setGraphView({ kind: "function", graphId: lists.functionIds[0]! });
    }
  }, [payload.focusFieldId, graphView, lists.eventIds, lists.functionIds]);

  useEffect(() => {
    if (explicitFocus) {
      return;
    }
    if (graphView !== null) {
      return;
    }
    if (lists.eventIds.length > 0) {
      const view: BlueprintEditorGraphView = { kind: "event", graphId: lists.eventIds[0]! };
      setGraphView(view);
      setMemberFocus({ kind: "graph", view });
    } else if (lists.functionIds.length > 0) {
      const view: BlueprintEditorGraphView = { kind: "function", graphId: lists.functionIds[0]! };
      setGraphView(view);
      setMemberFocus({ kind: "graph", view });
    }
  }, [explicitFocus, graphView, lists.eventIds, lists.functionIds]);

  const selectEventGraph = useCallback((eventId: string) => {
    const view: BlueprintEditorGraphView = { kind: "event", graphId: eventId };
    setGraphView(view);
    setMemberFocus({ kind: "graph", view });
    setSelectedNodeIds([]);
  }, []);

  const selectFunctionGraph = useCallback((functionId: string) => {
    const view: BlueprintEditorGraphView = { kind: "function", graphId: functionId };
    setGraphView(view);
    setMemberFocus({ kind: "graph", view });
    setSelectedNodeIds([]);
  }, []);

  const selectField = useCallback((fieldId: string) => {
    setMemberFocus({ kind: "field", fieldId });
    setSelectedNodeIds([]);
  }, []);

  const selectVariable = useCallback((variableId: string) => {
    setMemberFocus({ kind: "variable", variableId });
    setSelectedNodeIds([]);
  }, []);

  const selectBinding = useCallback((bindingId: string) => {
    setMemberFocus({ kind: "binding", bindingId });
    setSelectedNodeIds([]);
  }, []);

  const applyDiagnosticTarget = useCallback(
    (target: {
      kind: "graph" | "node" | "binding" | "field";
      graphKind?: "event" | "function";
      graphId?: string;
      nodeId?: string;
      fieldId?: string;
      bindingId?: string;
    }) => {
      if (target.kind === "field" && target.fieldId) {
        selectField(target.fieldId);
        return;
      }
      if (target.kind === "binding" && target.bindingId) {
        setMemberFocus({ kind: "binding", bindingId: target.bindingId });
        setSelectedNodeIds([]);
        return;
      }
      if (
        (target.kind === "graph" || target.kind === "node") &&
        target.graphKind &&
        target.graphId
      ) {
        if (target.graphKind === "event") {
          selectEventGraph(target.graphId);
        } else {
          selectFunctionGraph(target.graphId);
        }
        if (target.kind === "node" && target.nodeId) {
          setSelectedNodeIds([target.nodeId]);
        }
        return;
      }
    },
    [selectField, selectEventGraph, selectFunctionGraph]
  );

  return {
    graphView,
    memberFocus,
    selectedNodeIds,
    setGraphView,
    setMemberFocus,
    setSelectedNodeIds,
    selectEventGraph,
    selectFunctionGraph,
    selectField,
    selectVariable,
    selectBinding,
    applyDiagnosticTarget
  };
}
