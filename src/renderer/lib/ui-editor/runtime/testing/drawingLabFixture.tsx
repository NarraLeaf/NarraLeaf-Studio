/**
 * A page drawn by the real element tree, the real built-in widgets and the real Dev Mode runtime,
 * for the tests that ask which drawing an event lands in.
 *
 * The page holds a gallery - a list whose every row has a switch, a button, a text input and a
 * mark - and a volume control placed from a component that holds a slider. Each of those is a
 * widget that raises events of its own, from inside a row or inside a placement; what the tests
 * observe is what an author would: the lines the answering graphs log, and where the cursor went.
 *
 * Only imported from test files; it never ships in a product bundle.
 *
 * Comments in English per project convention.
 */

import { render } from "@testing-library/react";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { buildUIComponentSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import { BLUEPRINT_NODE_TYPE_ELEMENT_REF } from "@shared/types/blueprint/graph";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { TILE_STRUCT, type GraphNode, type createRowRuntime } from "./rowRuntimeTestKit";

export const LAB = "lab";

type Spec = {
    type: string;
    parent: string | null;
    extra?: Record<string, unknown>;
    props?: Record<string, unknown>;
    hidden?: true;
    layout?: Partial<UIElement["layout"]>;
};

function elementsOf(specs: Record<string, Spec>): Record<string, UIElement> {
    const out: Record<string, UIElement> = {};
    for (const [id, spec] of Object.entries(specs)) {
        out[id] = {
            id,
            type: spec.type,
            parentId: spec.parent,
            childrenIds: Object.entries(specs).filter(([, child]) => child.parent === id).map(([childId]) => childId),
            layout: { x: 0, y: 0, width: 60, height: 24, visible: !spec.hidden, ...spec.layout },
            ...(spec.props ? { props: spec.props } : {}),
            ...(spec.extra ? { extra: spec.extra } : {}),
        };
    }
    return out;
}

export const LAB_ROW_NAMES = ["Alpha", "Bravo", "Charlie"] as const;

export const labDocument: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "lab-doc",
    name: "Lab",
    surfaces: [
        {
            id: LAB,
            name: "Lab",
            host: "app",
            kind: "appSurface",
            designSize: { width: 640, height: 360 },
            rootElementId: "root",
        },
    ],
    structs: { [TILE_STRUCT.id]: TILE_STRUCT },
    elements: elementsOf({
        root: { type: "nl.root", parent: null, layout: { width: 640, height: 360 } },
        grid: {
            type: "nl.list",
            parent: "root",
            layout: { width: 400, height: 300 },
            props: {
                items: LAB_ROW_NAMES.map(name => ({ name })),
                itemStructId: TILE_STRUCT.id,
                itemKeyFieldId: "f-name",
            },
        },
        tile: { type: "nl.container", parent: "grid", extra: { listSlot: "itemTemplate" }, layout: { width: 400, height: 40 } },
        toggle: {
            type: "nl.switch",
            parent: "tile",
            props: { checked: false, trackElementId: "toggleTrack", thumbElementId: "toggleThumb" },
        },
        toggleTrack: { type: "nl.container", parent: "toggle", extra: { switchSlot: "track" } },
        toggleThumb: { type: "nl.container", parent: "toggle", extra: { switchSlot: "thumb" } },
        go: { type: "nl.button", parent: "tile", props: { label: "Go" } },
        entry: { type: "nl.textInput", parent: "tile", props: { value: "" } },
        mark: { type: "nl.container", parent: "tile" },
        volume: {
            type: "nl.container",
            parent: "root",
            extra: { componentLink: { componentId: "volumeDef", linked: true, params: { label: "Music" } } },
            layout: { width: 200, height: 40 },
        },
        echo: { type: "nl.container", parent: "root", hidden: true },
    }),
    components: [
        {
            id: "volumeDef",
            name: "Volume",
            rootElementId: "volumeRoot",
            params: [{ id: "label", name: "Label", type: "string", defaultValue: "" }],
            elements: elementsOf({
                volumeRoot: { type: "nl.container", parent: null, layout: { width: 200, height: 40 } },
                knob: {
                    type: "nl.slider",
                    parent: "volumeRoot",
                    layout: { width: 200, height: 40 },
                    props: { value: 50, min: 0, max: 100, step: 1, trackElementId: "knobTrack", handleElementId: "knobHandle" },
                },
                knobTrack: { type: "nl.container", parent: "knob", extra: { sliderSlot: "track" }, layout: { width: 200, height: 8 } },
                knobHandle: { type: "nl.container", parent: "knob", extra: { sliderSlot: "handle" }, layout: { width: 16, height: 16 } },
            }),
        },
    ],
};

/** An `Element` node naming an element of the lab page, or of the component definition that holds it. */
export function labElementRef(elementId: string): GraphNode {
    const component = labDocument.components?.find(item => Object.prototype.hasOwnProperty.call(item.elements, elementId));
    const table = component ? component.elements : labDocument.elements;
    return {
        type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
        params: {
            surfaceId: component ? buildUIComponentSurfaceId(component.id) : LAB,
            elementId,
            elementType: table[elementId]!.type,
        },
    };
}

/**
 * Draw the lab page the way a running game does: live widgets, the runtime's own widget state store,
 * inside a shell that names the surface - which is what measurement divides by.
 */
export function renderLabPage(page: ReturnType<typeof createRowRuntime>) {
    const registry = new ElementRendererRegistry(BuiltinElementRenderers);
    return render(
        <div data-ui-surface-id={LAB}>
            <WidgetRuntimeStateProvider externalStore={page.widgetRuntimeStore}>
                <SurfaceElementTree
                    document={page.document}
                    surface={page.surface}
                    rootElement={page.document.elements.root!}
                    rendererRegistry={registry}
                    hostAdapter={page.adapter}
                    editorChrome={true}
                />
            </WidgetRuntimeStateProvider>
        </div>,
    );
}

/** The element tree's list needs a ResizeObserver, which jsdom does not have. */
export function installResizeObserverStub(): void {
    if (typeof globalThis.ResizeObserver === "undefined") {
        globalThis.ResizeObserver = class {
            public observe(): void {}
            public unobserve(): void {}
            public disconnect(): void {}
        } as unknown as typeof ResizeObserver;
    }
}
