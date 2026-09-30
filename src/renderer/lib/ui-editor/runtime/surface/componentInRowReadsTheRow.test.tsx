// @vitest-environment jsdom
/**
 * A component placed in a list row is part of that row: its insides are drawn with the row.
 *
 * The definition's contents used to be rendered with no row at all, whatever the placement sat in.
 * A card placed in a gallery row therefore could not read the row it was in - a field binding inside
 * it drew the template's text on every row, and its graph's `Get Item Field` read nothing - and an
 * event starting inside the card reached the row's own widgets on its way out without the row
 * either. A plain text in the same row read the row perfectly, which is what made it look like the
 * card was built wrong.
 *
 * Comments in English per project convention.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
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

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 20 },
        ...more,
    };
}

/** A gallery whose every tile holds a card, and a card whose caption shows the row's name. */
const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface],
    structs: {
        entry: {
            id: "entry",
            fields: [
                { id: "f-id", key: "id", type: "string" },
                { id: "f-name", key: "name", type: "string" },
            ],
        },
    },
    elements: {
        root: element("root", "nl.root", null, ["grid"]),
        grid: element("grid", "nl.list", "root", ["tile"], {
            props: {
                items: [{ id: "cg-1", name: "Harbour" }, { id: "cg-2", name: "Lighthouse" }],
                itemStructId: "entry",
                itemKeyFieldId: "f-id",
            },
        }),
        tile: element("tile", "nl.box", "grid", ["card"], { extra: { listSlot: "itemTemplate" } }),
        card: element("card", "nl.box", "tile", [], { extra: { componentLink: { componentId: "cardDef", linked: true } } }),
    },
    components: [
        {
            id: "cardDef",
            name: "Card",
            rootElementId: "cardRoot",
            elements: {
                cardRoot: element("cardRoot", "nl.container", null, ["caption"]),
                caption: element("caption", "nl.text", "cardRoot", [], {
                    props: { text: "Name" },
                    valueBindings: { text: { kind: "listItemField", fieldId: "f-name" } },
                }),
            },
        },
    ],
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
                        { type: "nl.box", render: props => <div>{props.children}</div> },
                        { type: "nl.container", render: props => <div>{props.children}</div> },
                        {
                            type: "nl.text",
                            render: props => <span data-testid="caption">{String((props.element.props as { text?: unknown }).text)}</span>,
                        },
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

const rowKey = (key: string) => buildUIListItemInstanceKey(undefined, "grid", key);
const cardIn = (key: string) => buildUIComponentInstanceKey(rowKey(key), "card");

describe("a component placed in a list row", () => {
    it("draws a field binding inside it with the row it is in", () => {
        const { getAllByTestId } = mount([]);

        expect(getAllByTestId("caption").map(node => node.textContent)).toEqual(["Harbour", "Lighthouse"]);
    });

    it("starts its insides with the row, so their graphs can read it", async () => {
        const dispatched: Dispatched[] = [];
        mount(dispatched);

        await waitFor(() => {
            expect(dispatched.filter(entry => entry.elementId === "cardRoot" && entry.eventName === "init")).toHaveLength(2);
        });
        const inits = dispatched.filter(entry => entry.elementId === "cardRoot" && entry.eventName === "init");
        expect(inits.map(entry => [entry.options?.listItemScope?.key, entry.options?.instanceKey])).toEqual([
            ["cg-1", cardIn("cg-1")],
            ["cg-2", cardIn("cg-2")],
        ]);
    });

    it("tells a press inside it which row it is in", () => {
        const dispatched: Dispatched[] = [];
        const { container } = mount(dispatched);

        fireEvent.click(container.querySelector<HTMLElement>("[data-ui-list-item-key='cg-2'] [data-testid='caption']")!);

        const press = dispatched.find(entry => entry.elementId === "caption" && entry.eventName === "mouseClick");
        expect(press?.options?.listItemScope?.key).toBe("cg-2");
        expect(press?.options?.instanceKey).toBe(cardIn("cg-2"));
    });
});
