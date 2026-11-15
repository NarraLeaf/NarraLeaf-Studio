// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { blueprintBreakpointKey } from "@shared/types/blueprint/breakpoints";
import { BlueprintDebuggerProvider } from "./BlueprintDebuggerContext";
import { BlueprintDebuggerOverlay } from "./BlueprintDebuggerOverlay";
import { BlueprintDebuggerPanel } from "./BlueprintDebuggerPanel";

const breakpoint = { blueprintId: "bp", graphId: "graph", nodeId: "node", enabled: true };
vi.mock("@/lib/ui-editor/blueprint-runtime/useBlueprintBreakpoints", () => ({
    useBlueprintBreakpoints: () => ({
        breakpoints: [breakpoint], byKey: new Map([[blueprintBreakpointKey(breakpoint), breakpoint]]),
        toggle: vi.fn(), setEnabled: vi.fn(), configure: vi.fn(), remove: vi.fn(), removeAll: vi.fn(),
    }),
}));
vi.mock("@/lib/ui-editor/blueprint-debug/BlueprintBreakpointDialog", () => ({
    BlueprintBreakpointDialog: ({ open, nodeLabel, variables }: { open: boolean; nodeLabel?: string; variables: { name: string }[] }) => open
        ? <div role="dialog">{nodeLabel} | {variables.map(variable => variable.name).join(", ")}</div> : null,
}));
vi.mock("./BlueprintReadonlyGraphView", () => ({ BlueprintReadonlyGraphView: () => <div>Graph view</div> }));

afterEach(cleanup);

describe("BlueprintDebuggerPanel", () => {
    it("opens the selected breakpoint's editor while the graph browser is closed", () => {
        const document = {
            blueprints: {
                bp: {
                    id: "bp", name: "Blueprint", owner: { kind: "globalMain" },
                    graphs: { events: { graph: { id: "graph", name: "Event", graph: {
                        nodes: { node: { id: "node", type: "test.node" } }, edges: [],
                    } } }, functions: {} },
                    members: { variables: { score: { id: "score", name: "Score" } }, fields: {}, functions: {} },
                },
            },
        } as unknown as BlueprintDocument;
        render(<BlueprintDebuggerProvider session={null} blueprintDocument={document} projectPath={null}>
            <BlueprintDebuggerPanel />
            <BlueprintDebuggerOverlay />
        </BlueprintDebuggerProvider>);
        expect(screen.queryByRole("dialog")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Edit breakpoint…" }));
        expect(screen.getByRole("dialog").textContent).toBe("test.node | Score");
    });
});
