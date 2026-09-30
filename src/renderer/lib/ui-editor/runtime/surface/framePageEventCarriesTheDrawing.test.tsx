// @vitest-environment jsdom
/**
 * A page inside a frame talks back to the frame in the drawing the frame is in.
 *
 * The frame's Page Event is raised by the nested page's runtime, which knows the frame only as an
 * element - and used to raise it with the frame's bare id. A frame in a list row therefore heard its
 * page with no row, so a graph asking which row's frame had spoken read nothing. The nested runtime
 * is now handed the frame's own dispatch, bound where the frame is drawn.
 *
 * Comments in English per project convention.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import type { UIHostAdapter, UIHostAdapterElementEventOptions } from "@/lib/ui-editor/runtime/types";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { TILE_STRUCT } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import { SurfaceElementTree, type NestedSurfaceRuntimeInput } from "./SurfaceElementTree";

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 100 }, ...more };
}

/** A list of two tiles, each holding a frame onto the same small page. */
const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        { id: "host", name: "Host", host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: "root" },
        { id: "child", name: "Child", host: "app", kind: "appSurface", designSize: { width: 200, height: 100 }, rootElementId: "childRoot" },
    ],
    structs: { [TILE_STRUCT.id]: TILE_STRUCT },
    elements: {
        root: element("root", "nl.root", null, ["grid"]),
        grid: element("grid", "nl.list", "root", ["tile"], {
            props: { items: [{ name: "Alpha" }, { name: "Bravo" }], itemStructId: TILE_STRUCT.id, itemKeyFieldId: "f-name" },
        }),
        tile: element("tile", "nl.container", "grid", ["inner"], { extra: { listSlot: "itemTemplate" } }),
        inner: element("inner", "nl.frame", "tile", [], { props: { targetSurfaceId: "child" } }),
        childRoot: element("childRoot", "nl.root", null, []),
    },
};

type Dispatched = { elementId: string; eventName: string; options?: UIHostAdapterElementEventOptions };

beforeAll(() => {
    installResizeObserverStub();
});

afterEach(() => cleanup());

describe("a frame in a list row", () => {
    it("hears its nested page's events as that row", async () => {
        const dispatched: Dispatched[] = [];
        const hostAdapter = {
            host: "app",
            blueprintRuntime: {
                surfaceId: "host",
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async (
                    elementId: string,
                    eventName: string,
                    _payload?: unknown,
                    options?: UIHostAdapterElementEventOptions,
                ) => {
                    dispatched.push({ elementId, eventName, options });
                },
            },
        } as unknown as UIHostAdapter;
        const inputs = new Map<string, NestedSurfaceRuntimeInput>();

        render(
            <WidgetRuntimeStateProvider>
                <SurfaceElementTree
                    document={document}
                    surface={document.surfaces[0]!}
                    rootElement={document.elements.root!}
                    rendererRegistry={new ElementRendererRegistry(BuiltinElementRenderers)}
                    hostAdapter={hostAdapter}
                    editorChrome={true}
                    nestedSurfaceRuntime={{
                        createHostAdapter: input => {
                            inputs.set(input.instanceKey, input);
                            return { host: "app" };
                        },
                    }}
                />
            </WidgetRuntimeStateProvider>,
        );
        const bravo = buildUIListItemInstanceKey(undefined, "grid", "Bravo");
        await waitFor(() => expect(inputs.has(bravo)).toBe(true));

        await inputs.get(bravo)!.dispatchFrameEvent!("pageEvent", { event: "closed", data: null });

        const pageEvents = dispatched.filter(entry => entry.eventName === "pageEvent");
        expect(pageEvents.map(entry => [entry.elementId, entry.options?.instanceKey, entry.options?.listItemScope?.key])).toEqual([
            ["inner", bravo, "Bravo"],
        ]);
    });
});
