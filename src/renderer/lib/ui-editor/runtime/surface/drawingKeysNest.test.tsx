// @vitest-environment jsdom
/**
 * The drawing an element is rendered in is the drawing a graph can name.
 *
 * Two render-side halves of the rule in `widgetDrawing.ts`, each of which the rule cannot work
 * without:
 *
 * - A row of a list inside another list's row is keyed by both rows. Keyed by its own row alone,
 *   the second scene of chapter one and the second scene of chapter two were one drawing - their
 *   hover, their variables and every write to either landed on both - and a graph pressed in a scene
 *   had no way to say which chapter it was in.
 * - The parts of a slider (and a switch, and a list's authored scrollbar) are drawn in their owner's
 *   drawing. They used to be rendered under a key minted for them (`slider-<id>`), which is a
 *   drawing no graph could name: a write to the handle from anywhere landed on an address the
 *   handle was not rendered at.
 *
 * Asserted by rendering with a runtime patch at the address a graph now writes, and looking at what
 * is on the page.
 *
 * Comments in English per project convention.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import { resolveUIWidgetAddressFromDrawing } from "@shared/types/ui-editor/widgetDrawing";
import type { UIHostAdapter, UIHostAdapterElementEventOptions } from "@/lib/ui-editor/runtime/types";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { useWidgetRuntimeElementKey, WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { ListRenderer } from "@/lib/ui-editor/widget-modules/builtin/list/renderer";
import { SliderRenderer } from "@/lib/ui-editor/widget-modules/builtin/slider/renderer";
import { SurfaceElementTree } from "./SurfaceElementTree";

const surface: UISurface = {
    id: "surface",
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 640, height: 480 },
    rootElementId: "root",
};

const STRUCT_ID = "entry";

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

function listProps(ids: string[]): Record<string, unknown> {
    return { items: ids.map(id => ({ id })), itemStructId: STRUCT_ID, itemKeyFieldId: "f-id" };
}

/** Chapters, each holding a list of scenes; and one slider, drawn once, beside them. */
function screenDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [surface],
        structs: { [STRUCT_ID]: { id: STRUCT_ID, fields: [{ id: "f-id", key: "id", type: "string" }] } },
        elements: {
            root: element("root", "nl.root", null, ["chapters", "volume"]),
            chapters: element("chapters", "nl.list", "root", ["chapter"], undefined, listProps(["ch-1", "ch-2"])),
            chapter: element("chapter", "nl.box", "chapters", ["scenes"], { listSlot: "itemTemplate" }),
            scenes: element("scenes", "nl.list", "chapter", ["scene"], undefined, listProps(["s-1", "s-2"])),
            scene: element("scene", "nl.probe", "scenes", [], { listSlot: "itemTemplate" }),
            volume: element("volume", "nl.slider", "root", ["track", "handle"], undefined, {
                value: 50,
                min: 0,
                max: 100,
                step: 1,
                orientation: "horizontal",
                trackElementId: "track",
                handleElementId: "handle",
            }),
            track: element("track", "nl.probe", "volume", [], { sliderSlot: "track" }),
            handle: element("handle", "nl.probe", "volume", [], { sliderSlot: "handle" }),
        },
    };
}

function Probe({ elementId }: { elementId: string }) {
    const key = useWidgetRuntimeElementKey(elementId);
    return <span data-testid={`probe-${elementId}`} data-key={key} />;
}

function rendererRegistry(): ElementRendererRegistry {
    return new ElementRendererRegistry([
        { type: "nl.root", render: props => <>{props.children}</> },
        { type: "nl.box", render: props => <div>{props.children}</div> },
        { type: "nl.probe", render: props => <Probe elementId={props.element.id} /> },
        { type: "nl.list", render: props => <ListRenderer {...props} /> },
        { type: "nl.slider", render: props => <SliderRenderer {...props} /> },
    ]);
}

type Dispatched = { elementId: string; eventName: string; options?: UIHostAdapterElementEventOptions };

function hostAdapter(dispatched: Dispatched[]): UIHostAdapter {
    return {
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
}

function mount(document: UIDocument, patches: Record<string, DevModeWidgetRuntimePatch> = {}, dispatched: Dispatched[] = []) {
    return render(
        <WidgetRuntimeStateProvider>
            <SurfaceElementTree
                document={document}
                surface={surface}
                rootElement={document.elements.root!}
                rendererRegistry={rendererRegistry()}
                hostAdapter={hostAdapter(dispatched)}
                widgetRuntimePatches={patches}
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

const chapterTwo = buildUIListItemInstanceKey(undefined, "chapters", "ch-2");
const sceneOneOfChapterTwo = buildUIListItemInstanceKey(chapterTwo, "scenes", "s-1");

describe("a list inside another list's row", () => {
    it("draws every inner row as its own drawing, named by both rows", () => {
        const { getAllByTestId } = mount(screenDocument());
        const keys = getAllByTestId("probe-scene").map(node => node.getAttribute("data-key"));

        expect(keys).toHaveLength(4);
        expect(new Set(keys).size).toBe(4);
        expect(keys).toContain(buildUIWidgetAddress("scene", sceneOneOfChapterTwo));
    });

    it("draws a write addressed to one inner row in that row of that outer row only", () => {
        const document = screenDocument();
        // Where a graph pressed in that scene now writes when it hides the scene itself.
        const address = resolveUIWidgetAddressFromDrawing(document, "scene", sceneOneOfChapterTwo);
        const { getAllByTestId } = mount(document, { [address]: { visible: false } });

        const keys = getAllByTestId("probe-scene").map(node => node.getAttribute("data-key"));
        expect(keys).toHaveLength(3);
        // The one that went is that scene of chapter two; the same scene of chapter one is still up.
        expect(keys).not.toContain(address);
        expect(keys).toContain(buildUIWidgetAddress("scene", buildUIListItemInstanceKey(
            buildUIListItemInstanceKey(undefined, "chapters", "ch-1"),
            "scenes",
            "s-1",
        )));
    });

    it("tells a press on an inner row which outer row it is in", () => {
        const dispatched: Dispatched[] = [];
        const { container } = mount(screenDocument(), {}, dispatched);
        const chapterRows = container.querySelectorAll<HTMLElement>("[data-ui-list-item-key='ch-2']");
        const sceneRow = chapterRows[0]!.querySelector<HTMLElement>("[data-ui-list-item-key='s-1']")!;

        fireEvent.click(sceneRow);

        const click = dispatched.find(entry => entry.elementId === "scenes" && entry.eventName === "itemClick");
        expect(click?.options?.instanceKey).toBe(sceneOneOfChapterTwo);
    });
});

describe("a slider's parts", () => {
    it("are drawn in the slider's own drawing, where a write to them lands", () => {
        const document = screenDocument();
        // A graph beside the slider hiding its handle: no row, no placement, so the address is the
        // handle's id - and the handle has to be rendered there for the write to show.
        const address = resolveUIWidgetAddressFromDrawing(document, "handle", undefined);
        expect(address).toBe("handle");

        const { queryByTestId } = mount(document, { [address]: { visible: false } });

        expect(queryByTestId("probe-handle")).toBeNull();
        expect(queryByTestId("probe-track")).not.toBeNull();
    });
});
