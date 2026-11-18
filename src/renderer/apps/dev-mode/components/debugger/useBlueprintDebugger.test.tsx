// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlueprintDebugSession, BlueprintDebugSnapshot } from "@/lib/ui-editor/blueprint-runtime/BlueprintDebugSession";
import { useBlueprintDebugger } from "./useBlueprintDebugger";

afterEach(cleanup);

function debugSession() {
    let snapshot: BlueprintDebugSnapshot = { status: "running", stack: [], pausePending: false };
    const listeners = new Set<() => void>();
    const session = {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        setBreakpoints: vi.fn(),
    } as unknown as BlueprintDebugSession;
    const publish = (next: BlueprintDebugSnapshot) => {
        act(() => {
            snapshot = next;
            listeners.forEach(listener => listener());
        });
    };
    return { session, publish };
}

const pause = (blueprintId: string, graphId: string): BlueprintDebugSnapshot => ({
    status: "paused",
    pausedBlueprintId: blueprintId,
    pausedGraphId: graphId,
    stack: [],
    pausePending: false,
});

describe("useBlueprintDebugger graph selection", () => {
    it("opens the stopped graph, allows browsing while paused, and follows the next stop", () => {
        const { session, publish } = debugSession();
        const { result } = renderHook(() => useBlueprintDebugger({
            session,
            blueprintDocument: undefined,
            projectPath: null,
        }));

        act(() => result.current.setView("earlier", "graph"));
        publish(pause("first", "event"));
        expect([result.current.viewBlueprintId, result.current.viewGraphId]).toEqual(["first", "event"]);

        act(() => result.current.setView("other", "function"));
        expect([result.current.viewBlueprintId, result.current.viewGraphId]).toEqual(["other", "function"]);

        publish({ status: "running", stack: [], pausePending: false });
        expect([result.current.viewBlueprintId, result.current.viewGraphId]).toEqual(["other", "function"]);
        publish(pause("second", "event"));
        expect([result.current.viewBlueprintId, result.current.viewGraphId]).toEqual(["second", "event"]);
    });

    it("keeps the chosen graph across unrelated updates to the same pause", () => {
        const { session, publish } = debugSession();
        const { result } = renderHook(() => useBlueprintDebugger({ session, blueprintDocument: undefined, projectPath: null }));
        publish(pause("first", "event"));
        act(() => result.current.setView("other", "function"));
        publish({ ...pause("first", "event"), stack: [{ frameId: 1, runGraphId: "run", fnCallDepth: 0 }] });
        expect([result.current.viewBlueprintId, result.current.viewGraphId]).toEqual(["other", "function"]);
    });
});
