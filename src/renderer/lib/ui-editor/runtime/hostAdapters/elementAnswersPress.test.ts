/**
 * Which elements handle a press themselves - what a list asks of the controls in its rows before it
 * raises Item Click for a press on one of them (see `pressIsAnsweredInRow`).
 *
 * Two ways of wiring a click, one answer: the element's own Mouse Click, and an On Element Click
 * that names it from another blueprint. An element with neither - a hit area laid over a card - and
 * a list's own Item Click do not count: the press is still the row's.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { PAGE, blueprintOf, createRowRuntime, graphOf } from "../testing/rowRuntimeTestKit";

let page: ReturnType<typeof createRowRuntime> | null = null;
afterEach(() => {
    page?.release();
    page = null;
});

const headOnly = (type: string, params?: Record<string, unknown>) =>
    graphOf({ nodes: { head: { type, ...(params ? { params } : {}) }, log: { type: BLUEPRINT_NODE_TYPE_LOG } }, exec: ["head", "log"] });

describe("an element that handles a press itself", () => {
    it("is one with its own Mouse Click, or one an On Element Click names", () => {
        page = createRowRuntime([
            blueprintOf("bp-mark", { kind: "widgetMain", surfaceId: PAGE, elementId: "mark" }, {
                click: { graph: headOnly(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK) },
            }),
            blueprintOf("bp-viewer", { kind: "widgetMain", surfaceId: PAGE, elementId: "viewer" }, {
                named: {
                    graph: headOnly(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, {
                        surfaceId: PAGE,
                        elementId: "card",
                        elementType: "nl.container",
                    }),
                },
            }),
            blueprintOf("bp-grid", { kind: "widgetMain", surfaceId: PAGE, elementId: "grid" }, {
                row: { graph: headOnly(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK) },
            }),
        ]);
        const answers = page.runtime.elementAnswersPress!;
        expect(answers("mark")).toBe(true);
        expect(answers("card")).toBe(true);
        // The row's root, with nothing of its own, and a list whose rows answer presses.
        expect(answers("tile")).toBe(false);
        expect(answers("grid")).toBe(false);
        expect(answers("no-such-element")).toBe(false);
    });
});
