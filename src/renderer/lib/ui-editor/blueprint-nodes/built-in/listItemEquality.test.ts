import { describe, expect, it, vi } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REMOVE_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "../../runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";

describe("list item equality", () => {
    it.each([
        [BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM, false, "remove"],
        [BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REMOVE_ITEM, true, "remove"],
        [BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_ITEM, false, "select"],
        [BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_SELECTED_ITEM, true, "select"],
    ])("%s matches object fields independent of their order", async (type, element, operation) => {
        const items = [{ id: 1, info: { name: "Ada", score: 10 } }, { id: 2 }];
        const setListItems = vi.fn();
        const setListSelectedIndex = vi.fn();
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: { widget: { getListProperties: () => ({ items }), setListItems, setListSelectedIndex } },
            },
        } as unknown as UIHostAdapter;
        const graph: UIGraph = {
            id: "list-item-equality",
            entries: { main: { start: { nodeId: "list", port: "in" } } },
            nodes: {
                list: { id: "list", type, params: {} },
                item: { id: "item", type: BLUEPRINT_NODE_TYPE_LITERAL_JSON, params: { value: { info: { score: 10, name: "Ada" }, id: 1 } } },
                ref: { id: "ref", type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId: "page", elementId: "list-1", elementType: "nl.list" } },
            },
            edges: [
                { from: { nodeId: "item", port: "value" }, to: { nodeId: "list", port: "item" } },
                ...(element ? [{ from: { nodeId: "ref", port: "element" }, to: { nodeId: "list", port: "list" } }] : []),
            ],
        };

        await executeGraph({
            graph,
            entry: graph.entries.main,
            hostAdapter,
            executionOwner: { surfaceId: "page", elementId: element ? "button" : "list-1" },
        });

        if (operation === "remove") {
            expect(setListItems).toHaveBeenCalledWith("list-1", [{ id: 2 }]);
            expect(setListSelectedIndex).not.toHaveBeenCalled();
        } else {
            expect(setListSelectedIndex).toHaveBeenCalledWith("list-1", 0);
            expect(setListItems).not.toHaveBeenCalled();
        }
    });
});
