/**
 * A script names widgets by element id and reaches the drawing the widget nodes would.
 *
 * A script layer's `ctx.host` was the raw host API, which takes a widget *address* - so handed the
 * element id a script has, it wrote the element's template, which no list row and no component
 * placement draws. From a list's Item Click the pressed row's label never changed, and from inside a
 * card the card never did; the handler ran and nothing said a word. The context's own documentation
 * promised the runtime bound the drawing "exactly as the widget nodes do", and nothing did.
 *
 * Also here, because it is the same "what does this script know about where it is" question: a
 * script on a component element is handed the placement's params, and a list's script keeps the
 * list's variables in `ctx.vars` whichever row it is answering for.
 *
 * Comments in English per project convention.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { scriptLayerKey } from "@shared/blueprint/blueprintLayers";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { mountCompiledScripts, unmountCompiledScripts } from "@/lib/ui-editor/blueprint-runtime/script/scriptRuntime";
import type { GameScriptContext } from "@/lib/ui-editor/blueprint-runtime/script/scriptContext";
import { PAGE, blueprintOf, createRowRuntime, tileRow } from "../testing/rowRuntimeTestKit";

/** Mount one module per script layer, the way a bundle's compiled scripts are mounted. */
async function mountScripts(modules: Record<string, Record<string, unknown>>) {
    await mountCompiledScripts(
        Object.fromEntries(Object.keys(modules).map(layerKey => [layerKey, { scriptRef: `scripts/${layerKey}.ts`, url: layerKey }])),
        (layerKey, _scriptRef, message) => {
            throw new Error(`${layerKey} did not mount: ${message}`);
        },
        async url => modules[url]!,
    );
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

let page: ReturnType<typeof createRowRuntime>;
afterEach(() => {
    page.release();
    unmountCompiledScripts();
    expect(page.errors).toEqual([]);
});

describe("a script on a list, answering Item Click", () => {
    const row = buildUIListItemInstanceKey(undefined, "grid", "cg-2");
    const gridBlueprint = () =>
        blueprintOf("bp-grid", { kind: "widgetMain", surfaceId: PAGE, elementId: "grid" }, { script: { script: "grid" } }, {
            picked: "unset",
        });

    it("writes the pressed row's own widget in that row, and the panel beside the list on the page", async () => {
        page = createRowRuntime([gridBlueprint()]);
        await mountScripts({
            [scriptLayerKey("bp-grid", "script")]: {
                async onItemClick(ctx: GameScriptContext) {
                    await ctx.host.widget.setVisible("viewer", true);
                    await ctx.host.widget.setVisible("mark", false);
                },
            },
        });

        await page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index: 1 }, {
            listItemScope: tileRow("cg-2", 1),
            instanceKey: row,
        });

        expect(page.visibleWrites()).toEqual([
            ["viewer", true],
            [buildUIWidgetAddress("mark", row), false],
        ]);
    });

    it("reads back what it wrote in that row, and another row reads its own", async () => {
        page = createRowRuntime([gridBlueprint()]);
        const read: unknown[] = [];
        await mountScripts({
            [scriptLayerKey("bp-grid", "script")]: {
                async onItemClick(ctx: GameScriptContext) {
                    if (ctx.self.kind === "element" && ctx.self.row?.key === "cg-2") {
                        await ctx.host.widget.setVisible("mark", false);
                    }
                    read.push(ctx.host.widget.getDisplayableProperties("mark").visible);
                },
            },
        });
        const press = (key: string, index: number) =>
            page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index }, {
                listItemScope: tileRow(key, index),
                instanceKey: buildUIListItemInstanceKey(undefined, "grid", key),
            });

        await press("cg-2", 1);
        await press("cg-3", 2);

        // Hidden in the row that hid it; still showing in the next row, which nobody touched.
        expect(read).toEqual([false, true]);
    });

    it("keeps the list's variables in ctx.vars across rows", async () => {
        page = createRowRuntime([gridBlueprint()]);
        await mountScripts({
            [scriptLayerKey("bp-grid", "script")]: {
                onItemClick(ctx: GameScriptContext) {
                    ctx.host.devtools.log("info", String(ctx.vars.picked));
                    ctx.vars.picked = ctx.self.kind === "element" ? ctx.self.row?.key : undefined;
                },
            },
        });
        const press = (key: string, index: number) =>
            page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index }, {
                listItemScope: tileRow(key, index),
                instanceKey: buildUIListItemInstanceKey(undefined, "grid", key),
            });

        await press("cg-2", 1);
        await press("cg-3", 2);

        expect(page.logs).toEqual(["unset", "cg-2"]);
    });
});

describe("a script on a component placed in a list row", () => {
    const row = buildUIListItemInstanceKey(undefined, "grid", "cg-2");
    const placement = buildUIComponentInstanceKey(row, "card");

    it("writes its own widgets in this placement, and is handed this placement's params", async () => {
        page = createRowRuntime([
            blueprintOf("bp-card", { kind: "componentWidgetMain", componentId: "cardDef", elementId: "cardRoot" }, {
                script: { script: "card" },
            }),
        ]);
        const params: unknown[] = [];
        await mountScripts({
            [scriptLayerKey("bp-card", "script")]: {
                async onMouseClick(ctx: GameScriptContext) {
                    params.push(ctx.self.kind === "componentElement" ? ctx.self.params : null);
                    await ctx.host.widget.setVisible("badge", false);
                },
            },
        });

        await page.runtime.dispatchElementBlueprintEvent("cardRoot", "mouseClick", { x: 1, y: 1, button: 0 }, {
            componentId: "cardDef",
            componentParams: { slot: "3" },
            listItemScope: tileRow("cg-2", 1),
            instanceKey: placement,
        });

        expect(page.visibleWrites()).toEqual([[buildUIWidgetAddress("badge", placement), false]]);
        expect(params).toEqual([{ slot: "3" }]);
    });
});
