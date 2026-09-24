// @vitest-environment jsdom
/**
 * A Page widget inside a component definition draws the page it names, exactly as one on a page does.
 *
 * A component is drawn against a view of the document built for the placement: the definition's
 * elements under a surface of its own. That view used to hold *only* that surface, so a frame
 * inside the definition asked it for its page, found nothing, and drew "Missing Page" - in the
 * editor, in Dev Mode and in a shipped game alike, and whether the component sat on a page or in a
 * list row. The same frame on a page drew perfectly.
 *
 * Comments in English per project convention.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_FRAME_EMIT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import {
    WidgetRuntimeStateProvider,
    useWidgetRuntimeElementKey,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { TILE_STRUCT, blueprintOf, createRowRuntime, graphOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import { SurfaceElementTree, type NestedSurfaceRuntime, type NestedSurfaceRuntimeInput } from "./SurfaceElementTree";

const HOST = "host";
const CHILD = "child";
const CHILD_WORDS = "Drawn by the child page";

type Spec = { type: string; parent: string | null; props?: Record<string, unknown>; extra?: Record<string, unknown> };

function elementsOf(specs: Record<string, Spec>): Record<string, UIElement> {
    const out: Record<string, UIElement> = {};
    for (const [id, spec] of Object.entries(specs)) {
        out[id] = {
            id,
            type: spec.type,
            parentId: spec.parent,
            childrenIds: Object.entries(specs).filter(([, child]) => child.parent === id).map(([childId]) => childId),
            layout: { x: 0, y: 0, width: 200, height: 100 },
            ...(spec.props ? { props: spec.props } : {}),
            ...(spec.extra ? { extra: spec.extra } : {}),
        };
    }
    return out;
}

const placing = (label: string) => ({ componentLink: { componentId: "cardDef", linked: true, params: { label } } });

/**
 * A host page and a small child page. A card component holds a frame onto the child page; the host
 * places the card twice on its own and once more in every row of a two-row list.
 */
const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        { id: HOST, name: "Host", host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: "root" },
        { id: CHILD, name: "Child", host: "app", kind: "appSurface", designSize: { width: 200, height: 100 }, rootElementId: "childRoot" },
    ],
    structs: { [TILE_STRUCT.id]: TILE_STRUCT },
    elements: elementsOf({
        root: { type: "nl.root", parent: null },
        cardA: { type: "nl.container", parent: "root", extra: placing("A") },
        cardB: { type: "nl.container", parent: "root", extra: placing("B") },
        grid: {
            type: "nl.list",
            parent: "root",
            props: { items: [{ name: "Alpha" }, { name: "Bravo" }], itemStructId: TILE_STRUCT.id, itemKeyFieldId: "f-name" },
        },
        tile: { type: "nl.container", parent: "grid", extra: { listSlot: "itemTemplate" } },
        rowCard: { type: "nl.container", parent: "tile", extra: placing("row") },
        childRoot: { type: "nl.root", parent: null },
        childText: { type: "nl.text", parent: "childRoot", props: { text: CHILD_WORDS } },
    }),
    components: [
        {
            id: "cardDef",
            name: "Card",
            rootElementId: "cardRoot",
            params: [{ id: "label", name: "Label", type: "string", defaultValue: "" }],
            elements: elementsOf({
                cardRoot: { type: "nl.container", parent: null },
                window: { type: "nl.frame", parent: "cardRoot", props: { targetSurfaceId: CHILD } },
            }),
        },
    ],
};

function RuntimeKeyProbe({ elementId }: { elementId: string }) {
    return <span data-probe-key={useWidgetRuntimeElementKey(elementId)} />;
}

const placementKey = (placementId: string, outer?: string) => buildUIComponentInstanceKey(outer, placementId);
const rowKey = (name: string) => buildUIListItemInstanceKey(undefined, "grid", name);

beforeAll(() => {
    registerCoreBlueprintNodes();
    installResizeObserverStub();
});

afterEach(() => cleanup());

describe("a frame inside a component", () => {
    it("draws its page on the editing canvas, where nothing runs", () => {
        const markup = renderToStaticMarkup(
            <>
                {SurfaceElementTree({
                    document,
                    surface: document.surfaces[0]!,
                    rootElement: document.elements.root!,
                    rendererRegistry: new ElementRendererRegistry(BuiltinElementRenderers),
                    hostAdapter: { host: "app" },
                })}
            </>,
        );

        // Two placements and two rows: four drawings of the child page, and no placeholder.
        expect(markup.split(`data-ui-surface-id="${CHILD}"`).length - 1).toBe(4);
        expect(markup.split(CHILD_WORDS).length - 1).toBe(4);
    });

    it("refuses the page its own placement sits on, rather than drawing it without end", () => {
        // The card's frame names the host page, which places the card.
        const looping: UIDocument = {
            ...document,
            components: document.components!.map(component => ({
                ...component,
                elements: {
                    ...component.elements,
                    window: { ...component.elements.window!, props: { targetSurfaceId: HOST } },
                },
            })),
        };

        const markup = renderToStaticMarkup(
            <>
                {SurfaceElementTree({
                    document: looping,
                    surface: looping.surfaces[0]!,
                    rootElement: looping.elements.root!,
                    rendererRegistry: new ElementRendererRegistry(BuiltinElementRenderers),
                    hostAdapter: { host: "app" },
                })}
            </>,
        );

        expect(markup).toContain("Page loop blocked");
        expect(markup).not.toContain(`data-ui-surface-id="${HOST}"`);
    });

    it("draws a page that starts a drawing of its own, not one inside the placement around it", () => {
        // A widget that shows the key its runtime state is read under.
        const registry = new ElementRendererRegistry([
            ...BuiltinElementRenderers,
            { type: "test.probe", render: props => <RuntimeKeyProbe elementId={props.element.id} /> },
        ]);
        const probed: UIDocument = {
            ...document,
            elements: {
                ...document.elements,
                childText: { ...document.elements.childText!, type: "test.probe" },
            },
        };

        const markup = renderToStaticMarkup(
            <>
                {SurfaceElementTree({
                    document: probed,
                    surface: probed.surfaces[0]!,
                    rootElement: probed.elements.root!,
                    rendererRegistry: registry,
                    hostAdapter: { host: "app" },
                })}
            </>,
        );

        // Written by the page's runtime as the bare element - the page is drawn from its root - so
        // read that way too, in every placement and every row that shows it.
        const keys = [...markup.matchAll(/data-probe-key="([^"]*)"/g)].map(match => match[1]);
        expect(keys).toEqual(["childText", "childText", "childText", "childText"]);
    });

    it("draws its page in every placement and every row, each a drawing of its own, from the project's document", async () => {
        const inputs: NestedSurfaceRuntimeInput[] = [];
        const nestedSurfaceRuntime: NestedSurfaceRuntime = {
            createHostAdapter: input => {
                inputs.push(input);
                return { host: "app" };
            },
        };
        const hostAdapter = {
            host: "app",
            blueprintRuntime: {
                surfaceId: HOST,
                runtimeScopeId: "host-scope",
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async () => undefined,
            },
        } as unknown as UIHostAdapter;

        render(
            <WidgetRuntimeStateProvider>
                <SurfaceElementTree
                    document={document}
                    surface={document.surfaces[0]!}
                    rootElement={document.elements.root!}
                    rendererRegistry={new ElementRendererRegistry(BuiltinElementRenderers)}
                    hostAdapter={hostAdapter}
                    nestedSurfaceRuntime={nestedSurfaceRuntime}
                />
            </WidgetRuntimeStateProvider>,
        );

        const expected = [
            placementKey("cardA"),
            placementKey("cardB"),
            placementKey("rowCard", rowKey("Alpha")),
            placementKey("rowCard", rowKey("Bravo")),
        ];
        await waitFor(() => expect(new Set(inputs.map(input => input.instanceKey))).toEqual(new Set(expected)));
        for (const input of inputs) {
            expect(input.targetSurface.id).toBe(CHILD);
            expect(input.frameElement.id).toBe("window");
            // The page is a page: drawn from the document every page is drawn from, not from the
            // placement's view of it - which is rebuilt on every pass and would rebuild the page's
            // whole runtime with it.
            expect(input.document).toBe(document);
        }
        // One runtime per drawing: two placements of one frame are two pages, not one page twice.
        const scopes = new Set(inputs.map(input => input.runtimeScopeId));
        expect(scopes.size).toBe(expected.length);
    });

    it("runs the page's own blueprints, and hears the page as the placement it is drawn in", async () => {
        // The child page's text announces itself when it is drawn and tells the frame around it.
        const childText = blueprintOf("bp-child-text", { kind: "widgetMain", surfaceId: CHILD, elementId: "childText" }, {
            init: {
                graph: graphOf({
                    nodes: {
                        head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                        words: { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "child page ran" } },
                        log: { type: BLUEPRINT_NODE_TYPE_LOG },
                        emit: { type: BLUEPRINT_NODE_TYPE_FRAME_EMIT, params: { event: "drawn" } },
                    },
                    exec: ["head", "log", "emit"],
                    data: [["words", "value", "log", "value"]],
                }),
            },
        });
        // The frame, authored in the card, says which placement heard its page.
        const frame = blueprintOf("bp-window", { kind: "componentWidgetMain", componentId: "cardDef", elementId: "window" }, {
            heard: {
                graph: graphOf({
                    nodes: {
                        head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT },
                        label: { type: BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM, params: { paramId: "label" } },
                        log: { type: BLUEPRINT_NODE_TYPE_LOG },
                    },
                    exec: ["head", "log"],
                    data: [["label", "value", "log", "value"]],
                }),
            },
        });
        const blueprints = [childText, frame];
        const host = createRowRuntime(blueprints, { document });
        const pages: ReturnType<typeof createRowRuntime>[] = [];
        const nestedSurfaceRuntime: NestedSurfaceRuntime = {
            // What the game does for a frame's page: a runtime of its own on the target surface, whose
            // Emit Page Event goes out through the frame's own dispatch.
            createHostAdapter: input => {
                const page = createRowRuntime(blueprints, {
                    document,
                    surfaceId: input.targetSurface.id,
                    onFrameEmit: async (eventName, data) => {
                        await input.dispatchFrameEvent?.("pageEvent", { event: eventName, data });
                    },
                });
                pages.push(page);
                return page.adapter;
            },
        };

        try {
            render(
                <WidgetRuntimeStateProvider externalStore={host.widgetRuntimeStore}>
                    <SurfaceElementTree
                        document={document}
                        surface={host.surface}
                        rootElement={document.elements.root!}
                        rendererRegistry={new ElementRendererRegistry(BuiltinElementRenderers)}
                        hostAdapter={host.adapter}
                        nestedSurfaceRuntime={nestedSurfaceRuntime}
                    />
                </WidgetRuntimeStateProvider>,
            );

            // Each drawing of the page ran its own graph once, and the frame heard each one as the
            // placement that frame is in.
            await waitFor(() => expect(host.logs.slice().sort()).toEqual(["A", "B", "row", "row"]));
            const pageLogs = new Set(pages.flatMap(page => page.logs));
            expect([...pageLogs]).toEqual(["child page ran"]);
            expect(pages.filter(page => page.logs.includes("child page ran")).length).toBe(4);
            expect(host.errors).toEqual([]);
            expect(pages.flatMap(page => page.errors)).toEqual([]);
        } finally {
            host.release();
            for (const page of pages) {
                page.release();
            }
        }
    });
});
