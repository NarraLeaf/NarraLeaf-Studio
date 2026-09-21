/**
 * A list's own variables belong to the list, including while it answers an event about one row.
 *
 * Item Click, Item Hover and Item Render are the list's own events, handled by the list's own
 * blueprint, and they run in the row they are about - that is what lets them read the row's fields
 * and write to the row's own widgets. The list's variables were stored by that same row, so each row
 * had a private copy of them, defaulted on first use: a `Set Var` in Item Click ran, and no other
 * event of the list - not Init, not the next row's click - ever read what it wrote. The list is not
 * inside any of its rows, so a copy per row was never a thing the author could have meant.
 *
 * The rule is the one that sends a row's writes to the drawing their target is in
 * (`widgetDrawing.ts`), asked about the list's own id. A widget that *is* inside the row template
 * keeps one set of variables per row - that is still the right answer for it, and it is checked here
 * so the fix cannot drift into sharing those.
 *
 * Comments in English per project convention.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { PAGE, blueprintOf, createRowRuntime, graphOf, tileRow } from "../testing/rowRuntimeTestKit";

/** A list blueprint: Init says it is ready, a click logs what it knew and remembers the row, a hover logs what it knows. */
function rememberingListBlueprint(id: string, owner: Parameters<typeof blueprintOf>[1]) {
    return blueprintOf(
        id,
        owner,
        {
            init: {
                graph: graphOf({
                    nodes: {
                        head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                        ready: { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "ready" } },
                        set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "picked" } },
                    },
                    exec: ["head", "set"],
                    data: [["ready", "value", "set", "value"]],
                }),
            },
            click: {
                graph: graphOf({
                    nodes: {
                        head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK },
                        known: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "picked" } },
                        log: { type: BLUEPRINT_NODE_TYPE_LOG },
                        key: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY },
                        set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "picked" } },
                    },
                    exec: ["head", "log", "set"],
                    data: [
                        ["known", "value", "log", "value"],
                        ["key", "key", "set", "value"],
                    ],
                }),
            },
            hover: {
                graph: graphOf({
                    nodes: {
                        head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER },
                        known: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "picked" } },
                        log: { type: BLUEPRINT_NODE_TYPE_LOG },
                    },
                    exec: ["head", "log"],
                    data: [["known", "value", "log", "value"]],
                }),
            },
        },
        { picked: "unset" },
    );
}

/** A tile in the row template that logs whether this row's tile has been pressed before, then says it has. */
const tileBlueprint = blueprintOf(
    "bp-tile",
    { kind: "widgetMain", surfaceId: PAGE, elementId: "tile" },
    {
        press: {
            graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                    known: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "pressed" } },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                    yes: { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "yes" } },
                    set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "pressed" } },
                },
                exec: ["head", "log", "set"],
                data: [
                    ["known", "value", "log", "value"],
                    ["yes", "value", "set", "value"],
                ],
            }),
        },
    },
    { pressed: "no" },
);

beforeAll(() => {
    registerCoreBlueprintNodes();
});

let page: ReturnType<typeof createRowRuntime>;
afterEach(() => {
    page.release();
    expect(page.errors).toEqual([]);
});

const row = (key: string) => buildUIListItemInstanceKey(undefined, "grid", key);

describe("a list on the page", () => {
    it("reads in Item Click what its Init set", async () => {
        page = createRowRuntime([rememberingListBlueprint("bp-grid", { kind: "widgetMain", surfaceId: PAGE, elementId: "grid" })]);
        await page.runtime.dispatchElementBlueprintEvent("grid", "init");
        await page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index: 1 }, {
            listItemScope: tileRow("cg-2", 1),
            instanceKey: row("cg-2"),
        });

        expect(page.logs).toEqual(["ready"]);
    });

    it("reads in one row's event what another row's click set", async () => {
        page = createRowRuntime([rememberingListBlueprint("bp-grid", { kind: "widgetMain", surfaceId: PAGE, elementId: "grid" })]);
        await page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index: 1 }, {
            listItemScope: tileRow("cg-2", 1),
            instanceKey: row("cg-2"),
        });
        await page.runtime.dispatchElementBlueprintEvent("grid", "itemHover", { index: 2 }, {
            listItemScope: tileRow("cg-3", 2),
            instanceKey: row("cg-3"),
        });
        await page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index: 3 }, {
            listItemScope: tileRow("cg-4", 3),
            instanceKey: row("cg-4"),
        });

        // The first click knew nothing yet; the hover over another row and the click on a third
        // both see the row the first click remembered.
        expect(page.logs).toEqual(["unset", "cg-2", "cg-2"]);
    });

    it("still gives a widget inside the row template one set of variables per row", async () => {
        page = createRowRuntime([tileBlueprint]);
        const press = (key: string, index: number) =>
            page.runtime.dispatchElementBlueprintEvent("tile", "mouseClick", { x: 1, y: 1, button: 0 }, {
                listItemScope: tileRow(key, index),
                instanceKey: row(key),
            });

        await press("cg-1", 0);
        await press("cg-1", 0);
        await press("cg-2", 1);

        // The tile is drawn once per row, so each row's tile remembers its own press.
        expect(page.logs).toEqual(["no", "yes", "no"]);
    });
});

describe("a list inside a component placed twice", () => {
    const placementA = buildUIComponentInstanceKey(undefined, "shelfA");
    const placementB = buildUIComponentInstanceKey(undefined, "shelfB");
    const bookOf = (placement: string, key: string) => buildUIListItemInstanceKey(placement, "shelf", key);

    it("keeps the list's variables in its placement: shared by that placement's rows, apart from the other's", async () => {
        page = createRowRuntime([
            rememberingListBlueprint("bp-shelf", { kind: "componentWidgetMain", componentId: "shelfDef", elementId: "shelf" }),
        ]);
        await page.runtime.dispatchElementBlueprintEvent("shelf", "init", undefined, {
            componentId: "shelfDef",
            instanceKey: placementA,
        });
        await page.runtime.dispatchElementBlueprintEvent("shelf", "itemClick", { index: 0 }, {
            componentId: "shelfDef",
            listItemScope: tileRow("b-1", 0),
            instanceKey: bookOf(placementA, "b-1"),
        });
        await page.runtime.dispatchElementBlueprintEvent("shelf", "itemClick", { index: 0 }, {
            componentId: "shelfDef",
            listItemScope: tileRow("b-1", 0),
            instanceKey: bookOf(placementB, "b-1"),
        });

        // Shelf A's click sees shelf A's Init; shelf B never ran Init and never shared A's record.
        expect(page.logs).toEqual(["ready", "unset"]);
    });
});
