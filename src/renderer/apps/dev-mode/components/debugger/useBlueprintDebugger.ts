/**
 * Everything the debugger's two surfaces share: the panel beside the stage and the overlay that
 * takes the stage over while stopped. Both show the same graph, the same breakpoints and the same
 * stop, so both read this.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { isStorySyncValueOwner } from "@shared/types/blueprint/document";
import type { BlueprintBreakpoint } from "@shared/types/blueprint/breakpoints";
import type { BlueprintDebugSession, BlueprintDebugSnapshot } from "@/lib/ui-editor/blueprint-runtime/BlueprintDebugSession";
import {
    useBlueprintBreakpoints,
    type BlueprintBreakpointTarget,
} from "@/lib/ui-editor/blueprint-runtime/useBlueprintBreakpoints";
import { listEffectiveBlueprintVariables } from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import { listDevModeBlueprints, type DebuggableBlueprint } from "../blueprintDebugPanelModel";
import { resolveBlueprintGraphIr } from "./blueprintDebuggerModel";

const RUNNING: BlueprintDebugSnapshot = { status: "running", stack: [], pausePending: false };

export type BlueprintDebuggerContextMenuState = {
    position: { x: number; y: number };
    nodeId: string;
} | null;

export type UseBlueprintDebuggerResult = {
    snapshot: BlueprintDebugSnapshot;
    breakpoints: BlueprintBreakpoint[];
    breakpointsByKey: Map<string, BlueprintBreakpoint>;
    blueprints: DebuggableBlueprint[];
    /** Which graph the read-only view is showing - the stopped one, or whatever was picked. */
    viewBlueprintId: string | null;
    viewGraphId: string | null;
    setView: (blueprintId: string | null, graphId: string | null) => void;
    viewIr: ReturnType<typeof resolveBlueprintGraphIr>;
    /** False for the inline value / condition graphs the synchronous executor can never suspend. */
    viewPausable: boolean;
    /** Member variables of the viewed blueprint, for the condition editor. */
    viewVariables: { id: string; name: string }[];
    /** Toggle a breakpoint on a node of the graph currently in view. */
    toggleBreakpoint: (nodeId: string) => void;
    setBreakpointEnabled: (target: BlueprintBreakpointTarget, enabled: boolean) => void;
    removeBreakpoint: (target: BlueprintBreakpointTarget) => void;
    removeAllBreakpoints: () => void;
    configureBreakpoint: UseBlueprintDebuggerConfigure;
    contextMenu: BlueprintDebuggerContextMenuState;
    openContextMenu: (event: ReactMouseEvent, nodeId: string) => void;
    closeContextMenu: () => void;
    /** The breakpoint the condition dialog is open for, if any. */
    editingTarget: BlueprintBreakpointTarget | null;
    openBreakpointEditor: (target: BlueprintBreakpointTarget) => void;
    closeBreakpointEditor: () => void;
};

type UseBlueprintDebuggerConfigure = ReturnType<typeof useBlueprintBreakpoints>["configure"];

export function useBlueprintDebugger(input: {
    session: BlueprintDebugSession | null;
    blueprintDocument: BlueprintDocument | undefined;
    projectPath: string | null;
}): UseBlueprintDebuggerResult {
    const { session, blueprintDocument, projectPath } = input;
    const breakpointStore = useBlueprintBreakpoints(projectPath);
    const { breakpoints, byKey, toggle, setEnabled, configure, remove, removeAll } = breakpointStore;

    const snapshot = useSyncExternalStore(
        useCallback(
            (listener: () => void) => (session ? session.subscribe(listener) : () => undefined),
            [session],
        ),
        useCallback(() => session?.getSnapshot() ?? RUNNING, [session]),
    );

    // The armed set is the session's copy of the table, pushed on every edit. Doing it here rather
    // than inside the session keeps the session free of any notion of where breakpoints are stored.
    useEffect(() => {
        session?.setBreakpoints(breakpoints);
    }, [session, breakpoints]);

    const blueprints = useMemo(
        () => listDevModeBlueprints(blueprintDocument?.blueprints ?? {}, { purpose: "breakpoints" }),
        [blueprintDocument],
    );

    const [picked, setPicked] = useState<{ blueprintId: string | null; graphId: string | null }>({
        blueprintId: null,
        graphId: null,
    });

    // Stopping somewhere always wins over what was being browsed: the author's attention is on the
    // stop, and the graph they were reading is one click away in the picker.
    const viewBlueprintId = snapshot.pausedBlueprintId ?? picked.blueprintId;
    const viewGraphId = snapshot.pausedGraphId ?? picked.graphId;

    const viewIr = useMemo(
        () => resolveBlueprintGraphIr(blueprintDocument, viewBlueprintId ?? undefined, viewGraphId ?? undefined),
        [blueprintDocument, viewBlueprintId, viewGraphId],
    );

    const viewBlueprint = viewBlueprintId ? blueprintDocument?.blueprints[viewBlueprintId] : undefined;
    const viewPausable = !viewBlueprint || !isStorySyncValueOwner(viewBlueprint.owner);
    const viewVariables = useMemo(
        () =>
            viewBlueprint
                ? listEffectiveBlueprintVariables(viewBlueprint).map(variable => ({
                      id: variable.id,
                      name: variable.name || variable.id,
                  }))
                : [],
        [viewBlueprint],
    );

    const [contextMenu, setContextMenu] = useState<BlueprintDebuggerContextMenuState>(null);
    const [editingTarget, setEditingTarget] = useState<BlueprintBreakpointTarget | null>(null);

    const target = useCallback(
        (nodeId: string): BlueprintBreakpointTarget | null =>
            viewBlueprintId && viewGraphId ? { blueprintId: viewBlueprintId, graphId: viewGraphId, nodeId } : null,
        [viewBlueprintId, viewGraphId],
    );

    return {
        snapshot,
        breakpoints,
        breakpointsByKey: byKey,
        blueprints,
        viewBlueprintId,
        viewGraphId,
        setView: useCallback((blueprintId, graphId) => setPicked({ blueprintId, graphId }), []),
        viewIr,
        viewPausable,
        viewVariables,
        toggleBreakpoint: useCallback(
            nodeId => {
                const entry = target(nodeId);
                if (entry) {
                    toggle(entry);
                }
            },
            [target, toggle],
        ),
        setBreakpointEnabled: setEnabled,
        removeBreakpoint: remove,
        removeAllBreakpoints: removeAll,
        configureBreakpoint: configure,
        contextMenu,
        openContextMenu: useCallback((event: ReactMouseEvent, nodeId: string) => {
            event.preventDefault();
            setContextMenu({ position: { x: event.clientX, y: event.clientY }, nodeId });
        }, []),
        closeContextMenu: useCallback(() => setContextMenu(null), []),
        editingTarget,
        openBreakpointEditor: useCallback((next: BlueprintBreakpointTarget) => {
            setContextMenu(null);
            setEditingTarget(next);
        }, []),
        closeBreakpointEditor: useCallback(() => setEditingTarget(null), []),
    };
}
