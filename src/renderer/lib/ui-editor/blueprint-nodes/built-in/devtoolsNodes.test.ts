import { describe, expect, it, vi } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_STRING_CONCAT,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "@/lib/ui-editor/behavior-graph";

describe("devtools blueprint nodes", () => {
    it("logs resolved values from wired pure data nodes", async () => {
        const graph: UIGraph = {
            id: "test",
            name: "test",
            entries: { main: { start: { nodeId: "log", port: "in" } } },
            nodes: {
                concat: {
                    id: "concat",
                    type: BLUEPRINT_NODE_TYPE_STRING_CONCAT,
                    params: { a: "Hello,", b: "World" },
                },
                log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
            },
            edges: [{ from: { nodeId: "concat", port: "result" }, to: { nodeId: "log", port: "value" } }],
        };
        const lines: string[] = [];
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const hostAdapter: UIHostAdapter = {
            host: "player",
            blueprintRuntime: {
                surfaceId: "surface",
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async () => undefined,
                hostApi: {
                    navigation: {
                        openSurface: async () => undefined,
                        closeLayer: async () => undefined,
                    },
                    widget: {
                        setVisible: async () => undefined,
                        setEnabled: async () => undefined,
                        setVariant: async () => undefined,
                    },
                    state: {
                        get: () => undefined,
                        set: () => undefined,
                    },
                    persistence: {
                        get: async () => undefined,
                        set: async () => undefined,
                    },
                    devtools: {
                        log: (_level, message) => {
                            lines.push(message);
                        },
                    },
                },
            },
        };

        await executeGraph({ graph, entry: graph.entries.main!, hostAdapter });

        expect(lines).toEqual(["Hello,World"]);
        consoleSpy.mockRestore();
    });
});
