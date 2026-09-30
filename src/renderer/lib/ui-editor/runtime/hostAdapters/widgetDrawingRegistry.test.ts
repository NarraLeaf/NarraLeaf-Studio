/**
 * What the runtime answers about the drawings on screen: which rows an element is in, and what a
 * widget address names.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import { rowDocument, tileRow } from "../testing/rowRuntimeTestKit";
import { createWidgetDrawingRegistry } from "./widgetDrawingRegistry";

const gridRow = (key: string) => buildUIListItemInstanceKey(undefined, "grid", key);

describe("the drawings of an element", () => {
    it("are one, naming nothing, for an element drawn once for the page", () => {
        const drawings = createWidgetDrawingRegistry(rowDocument);
        drawings.registerListRow("grid", { instanceKey: gridRow("a"), listItemScope: tileRow("a", 0) });

        expect(drawings.everyDrawingOf("viewer")).toEqual([{}]);
        // The list itself is not in any of its rows.
        expect(drawings.everyDrawingOf("grid")).toEqual([{}]);
    });

    it("are the rows on screen, in row order, for an element the list repeats", () => {
        const drawings = createWidgetDrawingRegistry(rowDocument);
        drawings.registerListRow("grid", { instanceKey: gridRow("b"), listItemScope: tileRow("b", 1) });
        drawings.registerListRow("grid", { instanceKey: gridRow("a"), listItemScope: tileRow("a", 0) });

        expect(drawings.everyDrawingOf("mark").map(drawing => [drawing.instanceKey, drawing.listItemScope?.key])).toEqual([
            [gridRow("a"), "a"],
            [gridRow("b"), "b"],
        ]);
    });

    it("are none while the list draws no rows, and lose a row once it is retracted", () => {
        const drawings = createWidgetDrawingRegistry(rowDocument);
        expect(drawings.everyDrawingOf("mark")).toEqual([]);

        const retract = drawings.registerListRow("grid", { instanceKey: gridRow("a"), listItemScope: tileRow("a", 0) });
        retract();

        expect(drawings.everyDrawingOf("mark")).toEqual([]);
    });

    it("keep a row re-announced under the same key when the one it replaced is retracted", () => {
        const drawings = createWidgetDrawingRegistry(rowDocument);
        const first = drawings.registerListRow("grid", { instanceKey: gridRow("a"), listItemScope: tileRow("a", 0, "Old") });
        drawings.registerListRow("grid", { instanceKey: gridRow("a"), listItemScope: tileRow("a", 0, "New") });
        first();

        expect(drawings.everyDrawingOf("mark").map(drawing => (drawing.listItemScope?.item as { name: string }).name)).toEqual(["New"]);
    });
});

describe("the drawing a widget address names", () => {
    it("is nothing for an address with no drawing", () => {
        expect(createWidgetDrawingRegistry(rowDocument).optionsForAddress("viewer")).toBeUndefined();
    });

    it("carries the row it is in, while that row is on screen", () => {
        const drawings = createWidgetDrawingRegistry(rowDocument);
        const row = tileRow("a", 0);
        drawings.registerListRow("grid", { instanceKey: gridRow("a"), listItemScope: row });

        expect(drawings.optionsForAddress(buildUIWidgetAddress("mark", gridRow("a")))).toEqual({
            listItemScope: row,
            instanceKey: gridRow("a"),
            componentId: undefined,
            componentParams: undefined,
        });
    });

    it("carries the component and the placement for an element inside one, and the row around the placement", () => {
        const drawings = createWidgetDrawingRegistry({
            ...rowDocument,
            components: rowDocument.components?.map(component =>
                component.id === "cardDef"
                    ? { ...component, params: [{ id: "slot", name: "Slot", type: "string" as const, defaultValue: "0" }] }
                    : component,
            ),
        });
        const row = tileRow("a", 0);
        drawings.registerListRow("grid", { instanceKey: gridRow("a"), listItemScope: row });
        const card = buildUIComponentInstanceKey(gridRow("a"), "card");

        expect(drawings.optionsForAddress(buildUIWidgetAddress("badge", card))).toEqual({
            listItemScope: row,
            instanceKey: card,
            componentId: "cardDef",
            componentParams: { slot: "0" },
        });
    });
});
