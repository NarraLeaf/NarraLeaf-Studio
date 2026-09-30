// @vitest-environment jsdom
/**
 * `Move Mouse To Element` sends the cursor to the copy of the element in the graph's own drawing.
 *
 * An element in a list row is on screen once per row. The node used to hand the host the bare
 * element id, and the host measured whichever copy the page held first - so a graph answering a
 * press on row 3 that moved the pointer to "its" button moved it to row 1's. It now addresses the
 * element the way every other element node does, and the host measures that drawing. It also keeps
 * the rule every other element node keeps: a graph reaches its own surface and nothing else.
 *
 * Comments in English per project convention.
 */
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO_ELEMENT,
} from "@shared/types/blueprint/graph";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import type { BlueprintPointerMoveRequest } from "@shared/types/blueprint/pointer";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { blueprintOf, createRowRuntime, graphOf, tileRow } from "./testing/rowRuntimeTestKit";
import { LAB, installResizeObserverStub, labDocument, labElementRef, renderLabPage } from "./testing/drawingLabFixture";

function stubRect(node: Element, rect: { left: number; top: number; width: number; height: number }): void {
    (node as HTMLElement).getBoundingClientRect = () =>
        ({
            ...rect,
            x: rect.left,
            y: rect.top,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height,
            toJSON: () => rect,
        }) as DOMRect;
}

/** Item Click on the gallery: move the pointer to `target`, instantly. */
function clickMovesTo(target: { type: string; params?: Record<string, unknown> }) {
    return graphOf({
        nodes: {
            head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK },
            target,
            move: { type: BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO_ELEMENT, params: { duration: 0 } },
        },
        exec: ["head", "move"],
        data: [["target", "element", "move", "element"]],
    });
}

beforeAll(() => {
    registerCoreBlueprintNodes();
    installResizeObserverStub();
});

let page: ReturnType<typeof createRowRuntime> | null = null;
afterEach(() => {
    cleanup();
    page?.release();
    page = null;
});

describe("Move Mouse To Element", () => {
    it("moves to the button in the row the graph is answering for", async () => {
        const moves: BlueprintPointerMoveRequest[] = [];
        page = createRowRuntime(
            [blueprintOf("bp-grid", { kind: "widgetMain", surfaceId: LAB, elementId: "grid" }, {
                click: { graph: clickMovesTo(labElementRef("go")) },
            })],
            {
                document: labDocument,
                onMovePointer: vi.fn(async request => {
                    moves.push(request);
                    return { outcome: "moved" as const };
                }),
            },
        );
        const { container } = renderLabPage(page);
        // The page is painted at its design size; each row's button sits 40 below the last.
        stubRect(container.querySelector("[data-ui-surface-id]")!, { left: 0, top: 0, width: 640, height: 360 });
        for (const node of container.querySelectorAll("[data-ui-element-id='go']")) {
            const index = Number(node.closest("[data-ui-list-item-index]")!.getAttribute("data-ui-list-item-index"));
            stubRect(node, { left: 100, top: 40 * index + 10, width: 60, height: 20 });
        }

        await act(async () => {
            fireEvent.click(container.querySelector<HTMLElement>("[data-ui-list-item-key='Charlie']")!);
        });

        expect(page.errors).toEqual([]);
        // Charlie is the third row: its button's centre, not the first row's.
        expect(moves.map(move => [move.clientX, move.clientY])).toEqual([[130, 100]]);
    });

    it("refuses an element on another surface, as every element node does", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-grid", { kind: "widgetMain", surfaceId: LAB, elementId: "grid" }, {
                click: {
                    graph: clickMovesTo({
                        type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                        params: { surfaceId: "elsewhere", elementId: "go", elementType: "nl.button" },
                    }),
                },
            })],
            { document: labDocument, onMovePointer: vi.fn(async () => ({ outcome: "moved" as const })) },
        );

        await page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index: 0 }, {
            listItemScope: tileRow("Alpha", 0),
            instanceKey: buildUIListItemInstanceKey(undefined, "grid", "Alpha"),
        });

        // Reported by the node and again by the dispatcher that caught it, as every node error is.
        expect(new Set(page.errors)).toEqual(new Set(["This node can only act on elements of its own page or component."]));
    });
});
