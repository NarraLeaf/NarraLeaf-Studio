// @vitest-environment jsdom
/**
 * The events a widget raises by itself arrive in the drawing the widget is in.
 *
 * A slider's Value Changed, a switch's Changed, a text input's Submit, a list's Scroll and a button
 * pressed from the keyboard are raised by the widget's own renderer, not by the pointer wrapper
 * around it - and each renderer used to spell its dispatch with the bare element id. Inside a
 * component placement the dispatcher then looked for the element on the page, found nothing, and
 * dropped the event without a word; inside a list row the event arrived with no row, so a graph
 * asking which row it was answering read nothing. A pointer event on the very same widget carried
 * both, because the wrapper builds its options from the drawing - which is why a click worked where
 * a drag did not.
 *
 * These drive the real element tree, the real widgets and the real Dev Mode runtime, and assert on
 * what an author sees: the line the answering graph logs.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SWITCH_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_TEXT_INPUT_SUBMIT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { blueprintOf, createRowRuntime, graphOf } from "./testing/rowRuntimeTestKit";
import { LAB, installResizeObserverStub, labDocument, renderLabPage } from "./testing/drawingLabFixture";

/** `head` → Log(what `value` says), with `value` any one pure node. */
function logs(headType: string, value: { type: string; params?: Record<string, unknown> }) {
    return graphOf({
        nodes: { head: { type: headType }, value, log: { type: BLUEPRINT_NODE_TYPE_LOG } },
        exec: ["head", "log"],
        data: [["value", "value", "log", "value"]],
    });
}

const rowName = { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "f-name" } };
const placementLabel = { type: BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM, params: { paramId: "label" } };

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

function rowOf(container: HTMLElement, name: string): HTMLElement {
    return container.querySelector<HTMLElement>(`[data-ui-list-item-key='${name}']`)!;
}

describe("a slider placed through a component", () => {
    function mountVolume() {
        page = createRowRuntime(
            [
                blueprintOf("bp-knob", { kind: "componentWidgetMain", componentId: "volumeDef", elementId: "knob" }, {
                    start: { graph: logs(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START, placementLabel) },
                    changed: { graph: logs(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED, placementLabel) },
                    flush: {
                        graph: logs(BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, {
                            type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                            params: { value: "flushed" },
                        }),
                    },
                }),
            ],
            { document: labDocument },
        );
        const view = renderLabPage(page);
        const track = view.container.querySelector<HTMLElement>("[data-ui-element-id='knobTrack']")!;
        return { view, track };
    }

    it("reaches the component's graph with its Drag Start and Value Changed, as this placement", async () => {
        const { track } = mountVolume();

        // jsdom lays nothing out, so the track measures one pixel wide from 0 and this is 70%.
        await act(async () => {
            fireEvent.pointerDown(track, { button: 0, clientX: 0.7, clientY: 0 });
        });
        await act(async () => {
            fireEvent.pointerUp(window, { clientX: 0.7, clientY: 0 });
        });

        await waitFor(() => expect(page!.logs).toContain("flushed"));
        expect(page!.logs.filter(line => line !== "flushed")).toEqual(["Music", "Music"]);
    });
});

describe("a switch in a list row", () => {
    it("tells its Changed which row it is in", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-toggle", { kind: "widgetMain", surfaceId: LAB, elementId: "toggle" }, {
                changed: { graph: logs(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SWITCH_CHANGED, rowName) },
            })],
            { document: labDocument },
        );
        const { container } = renderLabPage(page);

        await act(async () => {
            fireEvent.keyDown(rowOf(container, "Bravo").querySelector<HTMLElement>("[role='switch']")!, { key: " " });
        });

        await waitFor(() => expect(page!.logs).toEqual(["Bravo"]));
    });
});

describe("a button in a list row", () => {
    it("answers a key press as the row it is in", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-go", { kind: "widgetMain", surfaceId: LAB, elementId: "go" }, {
                click: { graph: logs(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, rowName) },
            })],
            { document: labDocument },
        );
        const { container } = renderLabPage(page);

        await act(async () => {
            fireEvent.keyDown(rowOf(container, "Charlie").querySelector<HTMLElement>("[role='button']")!, { key: "Enter" });
        });

        await waitFor(() => expect(page!.logs).toEqual(["Charlie"]));
    });
});

describe("a text input in a list row", () => {
    it("submits as the row it is in", async () => {
        page = createRowRuntime(
            [blueprintOf("bp-entry", { kind: "widgetMain", surfaceId: LAB, elementId: "entry" }, {
                submit: { graph: logs(BLUEPRINT_NODE_TYPE_EVENT_HEAD_TEXT_INPUT_SUBMIT, rowName) },
            })],
            { document: labDocument },
        );
        const { container } = renderLabPage(page);

        await act(async () => {
            fireEvent.keyDown(rowOf(container, "Alpha").querySelector<HTMLInputElement>("input")!, { key: "Enter" });
        });

        await waitFor(() => expect(page!.logs).toEqual(["Alpha"]));
    });
});

describe("the widget modules", () => {
    const LIB = path.resolve(__dirname, "..", "..");

    function sourceFiles(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                return sourceFiles(full);
            }
            return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
        });
    }

    /**
     * Every file that draws a widget, or hands a plugin the means to raise one of its events. Each
     * has the drawing bound for it (`dispatchEvent`, `widgetEventDispatch.ts`); reaching past that
     * to the host's own dispatch is how the component and the row went missing.
     */
    const drawers = () => [
        ...sourceFiles(path.join(LIB, "ui-editor", "widget-modules")),
        path.join(LIB, "ui-editor", "runtime", "EditorNodeWrapper.tsx"),
        path.join(LIB, "ui-editor", "runtime", "plugins", "loadRuntimePlugins.ts"),
        path.join(LIB, "plugins", "pluginWidgetGuard.ts"),
    ];

    it("raise a widget's events through the dispatch bound to its drawing, never the host's by id", () => {
        // A call, not a mention: the prop's documentation names the thing it replaces.
        const bare = drawers().filter(file => /\.\s*dispatchElementBlueprintEvent\s*\(/.test(fs.readFileSync(file, "utf-8")));

        expect(bare.map(file => path.relative(LIB, file))).toEqual([]);
    });
});
