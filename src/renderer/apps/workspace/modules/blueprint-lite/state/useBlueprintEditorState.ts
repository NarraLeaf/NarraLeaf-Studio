import { useCallback, useEffect, useMemo, useState } from "react";
import type { BlueprintEntryTabPayload } from "../blueprintEntryTabId";

export type BlueprintEditorGraphView =
    | { kind: "event"; graphId: string }
    | { kind: "function"; graphId: string };

export type BlueprintEditorMemberFocus =
    | { kind: "graph"; view: BlueprintEditorGraphView }
    | { kind: "declaration"; declarationId: string }
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
    selectDeclaration: (declarationId: string) => void;
    selectVariable: (variableId: string) => void;
    selectBinding: (bindingId: string) => void;
    applyDiagnosticTarget: (target: {
        kind: "graph" | "node" | "binding" | "declaration";
        graphKind?: "event" | "function";
        graphId?: string;
        nodeId?: string;
        declarationId?: string;
        bindingId?: string;
    }) => void;
};

function payloadHasExplicitFocus(payload: BlueprintEntryTabPayload): boolean {
    return Boolean(
        payload.focusDeclarationId ||
            payload.focusEventId ||
            payload.focusFunctionId ||
            payload.focusNodeId != null,
    );
}

export function useBlueprintEditorState(
    payload: BlueprintEntryTabPayload,
    lists: { eventIds: string[]; functionIds: string[] },
): BlueprintEditorState {
    const [graphView, setGraphView] = useState<BlueprintEditorGraphView | null>(null);
    const [memberFocus, setMemberFocus] = useState<BlueprintEditorMemberFocus>({ kind: "none" });
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);

    const explicitFocus = useMemo(() => payloadHasExplicitFocus(payload), [
        payload.focusDeclarationId,
        payload.focusEventId,
        payload.focusFunctionId,
        payload.focusNodeId,
    ]);

    const applyPayloadFocus = useCallback(() => {
        if (payload.focusDeclarationId) {
            setMemberFocus({ kind: "declaration", declarationId: payload.focusDeclarationId });
            setSelectedNodeIds([]);
            return;
        }
        if (payload.focusFunctionId) {
            const view: BlueprintEditorGraphView = { kind: "function", graphId: payload.focusFunctionId };
            setGraphView(view);
            setMemberFocus({ kind: "graph", view });
            setSelectedNodeIds(payload.focusNodeId ? [payload.focusNodeId] : []);
            return;
        }
        if (payload.focusEventId) {
            const view: BlueprintEditorGraphView = { kind: "event", graphId: payload.focusEventId };
            setGraphView(view);
            setMemberFocus({ kind: "graph", view });
            setSelectedNodeIds(payload.focusNodeId ? [payload.focusNodeId] : []);
            return;
        }
        setMemberFocus({ kind: "none" });
        setSelectedNodeIds(payload.focusNodeId ? [payload.focusNodeId] : []);
    }, [
        payload.focusDeclarationId,
        payload.focusEventId,
        payload.focusFunctionId,
        payload.focusNodeId,
    ]);

    useEffect(() => {
        applyPayloadFocus();
    }, [applyPayloadFocus]);

    // When navigating to a declaration only, show a graph canvas context without stealing inspector focus.
    useEffect(() => {
        if (!payload.focusDeclarationId) {
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
    }, [payload.focusDeclarationId, graphView, lists.eventIds, lists.functionIds]);

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

    const selectDeclaration = useCallback((declarationId: string) => {
        setMemberFocus({ kind: "declaration", declarationId });
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
            kind: "graph" | "node" | "binding" | "declaration";
            graphKind?: "event" | "function";
            graphId?: string;
            nodeId?: string;
            declarationId?: string;
            bindingId?: string;
        }) => {
            if (target.kind === "declaration" && target.declarationId) {
                selectDeclaration(target.declarationId);
                return;
            }
            if (target.kind === "binding" && target.bindingId) {
                setMemberFocus({ kind: "binding", bindingId: target.bindingId });
                setSelectedNodeIds([]);
                return;
            }
            if ((target.kind === "graph" || target.kind === "node") && target.graphKind && target.graphId) {
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
        [selectDeclaration, selectEventGraph, selectFunctionGraph],
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
        selectDeclaration,
        selectVariable,
        selectBinding,
        applyDiagnosticTarget,
    };
}
