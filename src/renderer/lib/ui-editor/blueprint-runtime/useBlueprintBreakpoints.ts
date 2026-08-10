/**
 * The project's breakpoint table, live in whichever window is asking.
 *
 * Both the Workspace blueprint editor (where breakpoints are usually set) and the Dev Mode
 * debugger (where they are hit, and can also be set on the read-only graph) use this. There is no
 * dedicated IPC channel for breakpoints and there does not need to be one: the global-state store
 * already broadcasts every write to every window, so one key is the whole synchronisation
 * mechanism. A breakpoint added in the editor is armed in the running game on the next frame.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    blueprintBreakpointKey,
    blueprintBreakpointsStateKey,
    parseBlueprintBreakpointTable,
    type BlueprintBreakpoint,
    type BlueprintBreakpointCondition,
} from "@shared/types/blueprint/breakpoints";
import { getInterface } from "@/lib/app/bridge";

export type BlueprintBreakpointTarget = {
    blueprintId: string;
    graphId: string;
    nodeId: string;
};

export type UseBlueprintBreakpointsResult = {
    breakpoints: BlueprintBreakpoint[];
    /** Keyed by `blueprintBreakpointKey`, for O(1) lookups while drawing a graph. */
    byKey: Map<string, BlueprintBreakpoint>;
    /** Add an enabled breakpoint, or remove the one already on that node. */
    toggle: (target: BlueprintBreakpointTarget) => void;
    setEnabled: (target: BlueprintBreakpointTarget, enabled: boolean) => void;
    /** Set (or clear, with nulls) a breakpoint's condition and hit count; creates it if absent. */
    configure: (
        target: BlueprintBreakpointTarget,
        options: { condition?: BlueprintBreakpointCondition | null; hitCountTarget?: number | null },
    ) => void;
    remove: (target: BlueprintBreakpointTarget) => void;
    removeAll: () => void;
};

export function useBlueprintBreakpoints(projectPath: string | null | undefined): UseBlueprintBreakpointsResult {
    const stateKey = useMemo(() => (projectPath ? blueprintBreakpointsStateKey(projectPath) : null), [projectPath]);
    const [breakpoints, setBreakpoints] = useState<BlueprintBreakpoint[]>([]);

    useEffect(() => {
        if (!stateKey) {
            setBreakpoints([]);
            return;
        }
        let active = true;
        void getInterface()
            .app.state.getGlobalState(stateKey)
            .then(result => {
                if (!active || !result.success) {
                    return;
                }
                setBreakpoints(parseBlueprintBreakpointTable(result.data.value).breakpoints);
            });

        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key !== stateKey) {
                return;
            }
            setBreakpoints(parseBlueprintBreakpointTable(change.value).breakpoints);
        });
        return () => {
            active = false;
            token?.cancel();
        };
    }, [stateKey]);

    // The local update lands immediately so the node's dot flips under the cursor; the broadcast
    // that comes back from the store then repeats it, which is a no-op with the same value.
    const write = useCallback(
        (next: BlueprintBreakpoint[]) => {
            setBreakpoints(next);
            if (!stateKey) {
                return;
            }
            void getInterface().app.state.setGlobalState(stateKey, { version: 1, breakpoints: next });
        },
        [stateKey],
    );

    const update = useCallback(
        (target: BlueprintBreakpointTarget, apply: (existing: BlueprintBreakpoint | undefined) => BlueprintBreakpoint | null) => {
            setBreakpoints(current => {
                const key = blueprintBreakpointKey(target);
                const existing = current.find(entry => blueprintBreakpointKey(entry) === key);
                const replacement = apply(existing);
                const next = current.filter(entry => blueprintBreakpointKey(entry) !== key);
                if (replacement) {
                    next.push(replacement);
                }
                if (stateKey) {
                    void getInterface().app.state.setGlobalState(stateKey, { version: 1, breakpoints: next });
                }
                return next;
            });
        },
        [stateKey],
    );

    const toggle = useCallback(
        (target: BlueprintBreakpointTarget) => {
            update(target, existing => (existing ? null : { ...target, enabled: true }));
        },
        [update],
    );

    const setEnabled = useCallback(
        (target: BlueprintBreakpointTarget, enabled: boolean) => {
            update(target, existing => ({ ...(existing ?? { ...target }), ...target, enabled }));
        },
        [update],
    );

    const configure = useCallback(
        (
            target: BlueprintBreakpointTarget,
            options: { condition?: BlueprintBreakpointCondition | null; hitCountTarget?: number | null },
        ) => {
            update(target, existing => {
                const base: BlueprintBreakpoint = existing ?? { ...target, enabled: true };
                const next: BlueprintBreakpoint = { ...base, ...target };
                if (options.condition !== undefined) {
                    if (options.condition) {
                        next.condition = options.condition;
                    } else {
                        delete next.condition;
                    }
                }
                if (options.hitCountTarget !== undefined) {
                    if (options.hitCountTarget && options.hitCountTarget > 1) {
                        next.hitCountTarget = Math.floor(options.hitCountTarget);
                    } else {
                        delete next.hitCountTarget;
                    }
                }
                return next;
            });
        },
        [update],
    );

    const remove = useCallback(
        (target: BlueprintBreakpointTarget) => {
            update(target, () => null);
        },
        [update],
    );

    const removeAll = useCallback(() => {
        write([]);
    }, [write]);

    const byKey = useMemo(() => {
        const map = new Map<string, BlueprintBreakpoint>();
        for (const breakpoint of breakpoints) {
            map.set(blueprintBreakpointKey(breakpoint), breakpoint);
        }
        return map;
    }, [breakpoints]);

    return { breakpoints, byKey, toggle, setEnabled, configure, remove, removeAll, };
}
