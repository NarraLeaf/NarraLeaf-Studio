// @vitest-environment jsdom
/**
 * An event no drawing raised - a broadcast, a window event - reaches a widget a list repeats once
 * in each row on screen, each run in its row.
 *
 * Such an event names nobody's drawing, and it used to run the widget's graph once as nobody. For a
 * widget drawn once, for the page, that is right and it still is. For a widget in a list row it
 * meant `Get Item Field` read nothing and `Set Property (self)` wrote to the template, which no row
 * draws: every node ran, the log was clean, no row changed. The answer is every row because every
 * row is a widget the player can see; a single page-level run is a run of a widget that is on screen
 * nowhere. That matches a key press, which each drawing already heard for itself.
 *
 * Comments in English per project convention.
 */
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { dispatchWidgetsBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { blueprintOf, createRowRuntime, graphOf } from "./testing/rowRuntimeTestKit";
import { LAB, installResizeObserverStub, labDocument, labElementRef, renderLabPage } from "./testing/drawingLabFixture";

function onBroadcastLogs(value: { type: string; params?: Record<string, unknown> }) {
    return graphOf({
        nodes: {
            head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST, params: { event: "ping" } },
            value,
            log: { type: BLUEPRINT_NODE_TYPE_LOG },
        },
        exec: ["head", "log"],
        data: [["value", "value", "log", "value"]],
    });
}

const rowName = { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "f-name" } };
const rowKey = (name: string) => buildUIListItemInstanceKey(undefined, "grid", name);

beforeAll(() => {
    registerCoreBlueprintNodes();
    installResizeObserverStub();
});

let page: ReturnType<typeof createRowRuntime> | null = null;
afterEach(() => {
    cleanup();
    page?.release();
    expect(page?.errors ?? []).toEqual([]);
    page = null;
});

/** The lab page with the gallery showing `names`. */
function labWithRows(names: readonly string[]): UIDocument {
    const grid = labDocument.elements.grid!;
    return {
        ...labDocument,
        elements: { ...labDocument.elements, grid: { ...grid, props: { ...grid.props, items: names.map(name => ({ name })) } } },
    };
}

describe("a broadcast", () => {
    it("reaches a widget in a list row once in every row, reading that row", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-mark", { kind: "widgetMain", surfaceId: LAB, elementId: "mark" }, {
                ping: { graph: onBroadcastLogs(rowName) },
            })],
            { document: labDocument },
        );
        renderLabPage(page);

        await page.runtime.dispatchBroadcastEvent!("ping", null);

        expect(page.logs).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    it("lets a row's widget write to itself in its own row", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-mark", { kind: "widgetMain", surfaceId: LAB, elementId: "mark" }, {
                ping: {
                    graph: graphOf({
                        nodes: {
                            head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST, params: { event: "ping" } },
                            self: labElementRef("mark"),
                            hide: {
                                type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
                                params: { property: "visible", value: false },
                            },
                        },
                        exec: ["head", "hide"],
                        data: [["self", "element", "hide", "element"]],
                    }),
                },
            })],
            { document: labDocument },
        );
        renderLabPage(page);

        await page.runtime.dispatchBroadcastEvent!("ping", null);

        // Not the template's address, which no row draws.
        expect(page.visibleWrites()).toEqual([
            [buildUIWidgetAddress("mark", rowKey("Alpha")), false],
            [buildUIWidgetAddress("mark", rowKey("Bravo")), false],
            [buildUIWidgetAddress("mark", rowKey("Charlie")), false],
        ]);
    });

    it("still reaches a page widget once, even while it is hidden", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-echo", { kind: "widgetMain", surfaceId: LAB, elementId: "echo" }, {
                ping: { graph: onBroadcastLogs({ type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "echo" } }) },
            })],
            { document: labDocument },
        );
        renderLabPage(page);

        await page.runtime.dispatchBroadcastEvent!("ping", null);

        expect(page.logs).toEqual(["echo"]);
    });

    it("reaches the rows the list is showing, however many that is", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-mark", { kind: "widgetMain", surfaceId: LAB, elementId: "mark" }, {
                ping: { graph: onBroadcastLogs(rowName) },
            })],
            { document: labWithRows(["Delta"]) },
        );
        renderLabPage(page);

        await page.runtime.dispatchBroadcastEvent!("ping", null);

        expect(page.logs).toEqual(["Delta"]);
    });

    it("reaches no row once the list has stopped drawing them", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-mark", { kind: "widgetMain", surfaceId: LAB, elementId: "mark" }, {
                ping: { graph: onBroadcastLogs(rowName) },
            })],
            { document: labDocument },
        );
        const view = renderLabPage(page);
        view.unmount();

        await page.runtime.dispatchBroadcastEvent!("ping", null);

        expect(page.logs).toEqual([]);
    });
});

describe("a key press", () => {
    // Not a fan-out the runtime runs: each drawing listens for keys itself, with its own drawing.
    // Pinned here beside the broadcast because the two are meant to agree - every row hears it.
    it("reaches a widget in a list row once in every row, reading that row", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-mark", { kind: "widgetMain", surfaceId: LAB, elementId: "mark" }, {
                key: {
                    graph: graphOf({
                        nodes: {
                            head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN },
                            name: rowName,
                            log: { type: BLUEPRINT_NODE_TYPE_LOG },
                        },
                        exec: ["head", "log"],
                        data: [["name", "value", "log", "value"]],
                    }),
                },
            })],
            { document: labDocument },
        );
        renderLabPage(page);
        const running = page;

        fireEvent.keyDown(window, { key: "k", code: "KeyK" });

        await waitFor(() => expect([...running.logs].sort()).toEqual(["Alpha", "Bravo", "Charlie"]));
    });
});

describe("a window event", () => {
    it("reaches a widget in a list row once in every row, reading that row", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-mark", { kind: "widgetMain", surfaceId: LAB, elementId: "mark" }, {
                focus: {
                    graph: graphOf({
                        nodes: {
                            head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED },
                            name: rowName,
                            log: { type: BLUEPRINT_NODE_TYPE_LOG },
                        },
                        exec: ["head", "log"],
                        data: [["name", "value", "log", "value"]],
                    }),
                },
            })],
            { document: labDocument },
        );
        renderLabPage(page);
        const running = page;

        await dispatchWidgetsBlueprintEvent({
            document: running.document,
            blueprintDocument: running.blueprintDocument,
            persistentVariables: {},
            surfaceId: LAB,
            runtimeScopeId: running.runtime.runtimeScopeId,
            eventName: "windowFocusChanged",
            eventPayload: { isFocused: false },
            hostAdapter: running.adapter,
            debug: { emit: () => undefined } as never,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        await waitFor(() => expect(running.logs).toEqual(["Alpha", "Bravo", "Charlie"]));
    });
});
