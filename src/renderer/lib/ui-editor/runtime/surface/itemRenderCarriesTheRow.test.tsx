// @vitest-environment jsdom
/**
 * Item Render is raised with the row it is drawing, as Item Click is raised with the row pressed.
 *
 * The one event a list has for per-row decoration used to be raised with the row's data in its
 * payload and nothing else: no row scope and no drawing key. So a handler could not read the row
 * with `Get Item Field` - it read nothing - and a write to the row's own label was addressed to the
 * label's template, which no row draws. Item Click, Item Hover and Selection Changed have always
 * carried both; this was the one that did not.
 *
 * Comments in English per project convention.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import type { UIHostAdapter, UIHostAdapterElementEventOptions } from "@/lib/ui-editor/runtime/types";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { ListRenderer } from "@/lib/ui-editor/widget-modules/builtin/list/renderer";
import { SurfaceElementTree } from "./SurfaceElementTree";

const surface: UISurface = {
    id: "surface",
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 640, height: 480 },
    rootElementId: "root",
};

function element(id: string, type: string, parentId: string | null, childrenIds: string[], extra?: Record<string, unknown>, props?: Record<string, unknown>): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 20 },
        ...(extra ? { extra } : {}),
        ...(props ? { props } : {}),
    };
}

const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface],
    structs: { entry: { id: "entry", fields: [{ id: "f-id", key: "id", type: "string" }] } },
    elements: {
        root: element("root", "nl.root", null, ["grid"]),
        grid: element("grid", "nl.list", "root", ["tile"], undefined, {
            items: [{ id: "cg-1" }, { id: "cg-2" }],
            itemStructId: "entry",
            itemKeyFieldId: "f-id",
        }),
        tile: element("tile", "nl.box", "grid", [], { listSlot: "itemTemplate" }),
    },
};

type Dispatched = { elementId: string; eventName: string; options?: UIHostAdapterElementEventOptions };

function mount(dispatched: Dispatched[]) {
    const hostAdapter = {
        host: "app",
        blueprintRuntime: {
            surfaceId: surface.id,
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async (elementId: string, eventName: string, _payload?: unknown, options?: UIHostAdapterElementEventOptions) => {
                dispatched.push({ elementId, eventName, options });
            },
            hostApi: {},
        },
    } as unknown as UIHostAdapter;
    return render(
        <WidgetRuntimeStateProvider>
            <SurfaceElementTree
                document={document}
                surface={surface}
                rootElement={document.elements.root!}
                rendererRegistry={
                    new ElementRendererRegistry([
                        { type: "nl.root", render: props => <>{props.children}</> },
                        { type: "nl.box", render: () => <div /> },
                        { type: "nl.list", render: props => <ListRenderer {...props} /> },
                    ])
                }
                hostAdapter={hostAdapter}
                editorChrome={false}
            />
        </WidgetRuntimeStateProvider>,
    );
}

beforeAll(() => {
    if (typeof globalThis.ResizeObserver === "undefined") {
        globalThis.ResizeObserver = class {
            public observe(): void {}
            public unobserve(): void {}
            public disconnect(): void {}
        } as unknown as typeof ResizeObserver;
    }
});

afterEach(() => cleanup());

describe("a list's Item Render", () => {
    it("is raised once per row with that row's scope and drawing", () => {
        const dispatched: Dispatched[] = [];
        mount(dispatched);

        const renders = dispatched.filter(entry => entry.elementId === "grid" && entry.eventName === "itemRender");
        expect(renders.map(entry => [entry.options?.listItemScope?.key, entry.options?.instanceKey])).toEqual([
            ["cg-1", buildUIListItemInstanceKey(undefined, "grid", "cg-1")],
            ["cg-2", buildUIListItemInstanceKey(undefined, "grid", "cg-2")],
        ]);
    });

    it("names the same drawing a click on that row does", () => {
        const dispatched: Dispatched[] = [];
        const { container } = mount(dispatched);

        fireEvent.click(container.querySelector<HTMLElement>("[data-ui-list-item-key='cg-2']")!);

        const click = dispatched.find(entry => entry.eventName === "itemClick");
        const render = dispatched.find(entry => entry.eventName === "itemRender" && entry.options?.listItemScope?.key === "cg-2");
        expect(render?.options?.instanceKey).toBeDefined();
        expect(render?.options?.instanceKey).toBe(click?.options?.instanceKey);
    });
});
