/**
 * A Fn called from a row's event runs in that row: it reads the row, writes to the row, and keeps
 * its owner's variables where its owner's own events keep them.
 *
 * A Fn is a piece of the calling graph pulled out to be given a name. Moving three nodes out of Item
 * Click into one used to change what they did without a word: the body ran with the caller's drawing
 * but not its row, so `Get Item Field` read nothing, and a Fn declared on a list inside a component
 * kept its variables in no placement at all - apart from everything the list's own events had set.
 *
 * Comments in English per project convention.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import { createBlueprintFnRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { PAGE, blueprintOf, createRowRuntime, elementRefNode, graphOf, tileRow } from "../testing/rowRuntimeTestKit";

/** Item Click that does nothing but call `fnRef`. */
function clickCalls(fnRef: string) {
    return graphOf({
        nodes: {
            head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK },
            call: { type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { [BLUEPRINT_NODE_PARAM_FN_REF]: fnRef } },
        },
        exec: ["head", "call"],
    });
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

let page: ReturnType<typeof createRowRuntime>;
afterEach(() => {
    page.release();
    expect(page.errors).toEqual([]);
});

describe("a Fn called from a list's Item Click", () => {
    const row = buildUIListItemInstanceKey(undefined, "grid", "cg-2");

    function gridBlueprint() {
        return blueprintOf("bp-grid", { kind: "widgetMain", surfaceId: PAGE, elementId: "grid" }, {
            click: { graph: clickCalls(createBlueprintFnRef("bp-grid", "open")) },
            fns: {
                graph: graphOf({
                    nodes: {
                        open: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "Open tile" } },
                        name: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "f-name" } },
                        log: { type: BLUEPRINT_NODE_TYPE_LOG },
                        mark: elementRefNode("mark"),
                        hide: {
                            type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
                            params: { property: "visible", value: false },
                        },
                    },
                    exec: ["open", "log", "hide"],
                    data: [
                        ["name", "value", "log", "value"],
                        ["mark", "element", "hide", "element"],
                    ],
                }),
            },
        });
    }

    it("reads the pressed row's field in the body", async () => {
        page = createRowRuntime([gridBlueprint()]);
        await page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index: 1 }, {
            listItemScope: tileRow("cg-2", 1, "Harbour at dusk"),
            instanceKey: row,
        });

        expect(page.logs).toEqual(["Harbour at dusk"]);
    });

    it("writes to the pressed row's own widget from the body", async () => {
        page = createRowRuntime([gridBlueprint()]);
        await page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index: 1 }, {
            listItemScope: tileRow("cg-2", 1),
            instanceKey: row,
        });

        expect(page.visibleWrites()).toEqual([[buildUIWidgetAddress("mark", row), false]]);
    });
});

describe("a Fn declared on a list inside a component placement", () => {
    const placementA = buildUIComponentInstanceKey(undefined, "shelfA");
    const book = buildUIListItemInstanceKey(placementA, "shelf", "b-1");

    it("sees the variables the list's own Init set in that placement", async () => {
        page = createRowRuntime([
            blueprintOf(
                "bp-shelf",
                { kind: "componentWidgetMain", componentId: "shelfDef", elementId: "shelf" },
                {
                    init: {
                        graph: graphOf({
                            nodes: {
                                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                                ready: { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "ready" } },
                                set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "state" } },
                            },
                            exec: ["head", "set"],
                            data: [["ready", "value", "set", "value"]],
                        }),
                    },
                    click: { graph: clickCalls(createBlueprintFnRef("bp-shelf", "report")) },
                    fns: {
                        graph: graphOf({
                            nodes: {
                                report: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "Report" } },
                                state: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "state" } },
                                log: { type: BLUEPRINT_NODE_TYPE_LOG },
                            },
                            exec: ["report", "log"],
                            data: [["state", "value", "log", "value"]],
                        }),
                    },
                },
                { state: "unset" },
            ),
        ]);
        await page.runtime.dispatchElementBlueprintEvent("shelf", "init", undefined, {
            componentId: "shelfDef",
            instanceKey: placementA,
        });
        await page.runtime.dispatchElementBlueprintEvent("shelf", "itemClick", { index: 0 }, {
            componentId: "shelfDef",
            listItemScope: tileRow("b-1", 0),
            instanceKey: book,
        });

        expect(page.logs).toEqual(["ready"]);
    });
});
