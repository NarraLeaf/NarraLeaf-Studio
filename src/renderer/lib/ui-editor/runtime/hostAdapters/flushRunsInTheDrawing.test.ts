/**
 * A widget's On Flush runs in the drawing that flushed: the row it is in, the placement it belongs to.
 *
 * Two roads lead to a flush and both used to lose the drawing. The runtime's flush queue was keyed
 * by element and kept no options, so every row of a list flushed as one run with no row, and a
 * widget inside a component placement flushed as an element the page does not have - dropped. And a
 * flush set off by a graph's write reached the runtime as the bare element, although the write had
 * landed on one drawing: a card that hid its own badge never heard its own flush.
 *
 * Comments in English per project convention.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { blueprintOf, createRowRuntime, graphOf, tileRow } from "../testing/rowRuntimeTestKit";
import { LAB, labDocument } from "../testing/drawingLabFixture";

function flushLogs(value: { type: string; params?: Record<string, unknown> }) {
    return graphOf({
        nodes: { head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH }, value, log: { type: BLUEPRINT_NODE_TYPE_LOG } },
        exec: ["head", "log"],
        data: [["value", "value", "log", "value"]],
    });
}

async function settle(logs: readonly string[], count: number): Promise<void> {
    for (let attempt = 0; attempt < 50 && logs.length < count; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    // One more turn, so a run that should not have happened has had its chance to.
    await new Promise(resolve => setTimeout(resolve, 20));
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

let page: ReturnType<typeof createRowRuntime> | null = null;
afterEach(() => {
    page?.release();
    expect(page?.errors ?? []).toEqual([]);
    page = null;
});

describe("the flush queue", () => {
    it("keeps one flush per drawing, each with its row", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-toggle", { kind: "widgetMain", surfaceId: LAB, elementId: "toggle" }, {
                flush: { graph: flushLogs({ type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "f-name" } }) },
            })],
            { document: labDocument },
        );

        for (const [index, name] of ["Alpha", "Bravo"].entries()) {
            void page.runtime.dispatchElementBlueprintEvent("toggle", "flush", undefined, {
                listItemScope: tileRow(name, index),
                instanceKey: buildUIListItemInstanceKey(undefined, "grid", name),
            });
        }
        await settle(page.logs, 2);

        expect(page.logs).toEqual(["Alpha", "Bravo"]);
    });
});

describe("a flush a graph's write sets off", () => {
    it("runs in the placement the write landed on", async () => {
        const placement = buildUIComponentInstanceKey(undefined, "volume");
        page = createRowRuntime(
            [blueprintOf("bp-knob", { kind: "componentWidgetMain", componentId: "volumeDef", elementId: "knob" }, {
                init: {
                    graph: graphOf({
                        nodes: {
                            head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                            hide: {
                                type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
                                params: { property: "visible", value: false },
                            },
                        },
                        exec: ["head", "hide"],
                    }),
                },
                flush: { graph: flushLogs({ type: BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM, params: { paramId: "label" } }) },
            })],
            { document: labDocument },
        );

        await page.runtime.dispatchElementBlueprintEvent("knob", "init", undefined, {
            componentId: "volumeDef",
            componentParams: { label: "Music" },
            instanceKey: placement,
        });
        await settle(page.logs, 1);

        expect(page.logs).toEqual(["Music"]);
    });
});
