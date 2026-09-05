// @vitest-environment jsdom
/**
 * Blueprint Value bindings, exercised through the real render path (not by driving
 * `BlueprintValueRuntimeStore` directly), under `React.StrictMode`.
 *
 * StrictMode is on in every unpackaged build - `renderApp.tsx` wraps the tree in it whenever
 * `platformInfo.isPackaged` is false - so its mount / teardown / mount cycle is the shape Dev Mode
 * actually runs in. A store owned by `useMemo` was disposed by the throwaway teardown and then
 * synced while dead, which silently disabled every value binding on every surface: no error, no
 * evaluation, the authored placeholder rendered forever. These tests fail without the boundary
 * owning the store's lifetime.
 */
import { StrictMode } from "react";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { render, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import {
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
} from "@shared/types/blueprint/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { SurfaceStateStore } from "@/lib/ui-editor/blueprint-runtime/SurfaceStateStore";
import { ListRenderer } from "@/lib/ui-editor/widget-modules/builtin/list/renderer";
import { SurfaceElementTree, type SurfaceBlueprintBindingContext } from "./SurfaceElementTree";

const SURFACE_ID = "surface";
const SCOPE_ID = "scope-1";

const surface: UISurface = {
    id: SURFACE_ID,
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 240 },
    rootElementId: "root",
};

/** `Init -> Return Value` fed by a bare string literal. */
function literalGraph(value: string): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
            value: { id: "value", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value } },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        },
        edges: [
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "value", port: "value" }, to: { nodeId: "ret", port: "value" } },
        ],
    };
}

/** `Init | Flush -> Return Value` fed by `Get List Item Props -> Get JSON Field -> To String`. */
function listItemFieldGraph(path: string): BlueprintGraphIr {
    return {
        nodes: {
            init: { id: "init", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
            flush: { id: "flush", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, params: {} },
            getProps: { id: "getProps", type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS, params: {} },
            getField: { id: "getField", type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET, params: { path } },
            toString: { id: "toString", type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING, params: {} },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        },
        edges: [
            { from: { nodeId: "init", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "flush", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "getProps", port: "props" }, to: { nodeId: "getField", port: "json" } },
            { from: { nodeId: "getField", port: "result" }, to: { nodeId: "toString", port: "value" } },
            { from: { nodeId: "toString", port: "result" }, to: { nodeId: "ret", port: "value" } },
        ],
    };
}

/**
 * `Init | Flush -> Return Value` fed by the row's own field, with no `To String` in the way.
 *
 * The missing conversion is the point: a picture-bearing field holds an `ImageAsset` record, and
 * this is the graph an author writes when the value they want is that record.
 */
function imageAssetGraph(path: string): BlueprintGraphIr {
    return {
        nodes: {
            init: { id: "init", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
            flush: { id: "flush", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, params: {} },
            getProps: { id: "getProps", type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS, params: {} },
            getField: { id: "getField", type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET, params: { path } },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        },
        edges: [
            { from: { nodeId: "init", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "flush", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "getProps", port: "props" }, to: { nodeId: "getField", port: "json" } },
            { from: { nodeId: "getField", port: "result" }, to: { nodeId: "ret", port: "value" } },
        ],
    };
}

function valueBlueprintDocument(input: {
    blueprintId: string;
    elementId: string;
    graph: BlueprintGraphIr;
    propPath?: string;
}): BlueprintDocument {
    const propPath = input.propPath ?? "text";
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            [input.blueprintId]: {
                id: input.blueprintId,
                name: "Text value",
                owner: { kind: "widgetValue", surfaceId: SURFACE_ID, elementId: input.elementId, propPath },
                members: { variables: {}, fields: {}, functions: {} },
                graphs: { events: { init: { id: "init", graph: input.graph } }, functions: {} },
            },
        },
        ownerRecords: {
            [encodeBlueprintOwnerKey({ kind: "widgetValue", surfaceId: SURFACE_ID, elementId: input.elementId, propPath })]: {
                blueprintId: input.blueprintId,
            },
        },
    };
}

function plainTextDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [surface],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["text"],
                layout: { x: 0, y: 0, width: 320, height: 240 },
            },
            text: {
                id: "text",
                type: "nl.text",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 40 },
                props: { text: "AUTHORED" },
                valueBindings: { text: { kind: "blueprintValue", blueprintId: "bp-value", valueType: "string" } },
            },
        },
    };
}

function listDocument(items: Array<Record<string, unknown>>): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [surface],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["list"],
                layout: { x: 0, y: 0, width: 320, height: 240 },
            },
            list: {
                id: "list",
                type: "nl.list",
                parentId: "root",
                childrenIds: ["row"],
                layout: { x: 0, y: 0, width: 320, height: 240 },
                props: { items, itemKeyFieldId: "id" },
            },
            row: {
                id: "row",
                type: "nl.text",
                parentId: "list",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 30 },
                props: { text: "AUTHORED" },
                extra: { listSlot: "itemTemplate" },
                valueBindings: { text: { kind: "blueprintValue", blueprintId: "bp-value", valueType: "string" } },
            },
        },
    };
}

/** A list of `nl.image` rows, each binding its picture to the value blueprint. */
function imageListDocument(items: Array<Record<string, unknown>>): UIDocument {
    const document = listDocument(items);
    document.elements.row = {
        id: "row",
        type: "nl.image",
        parentId: "list",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 40, height: 40 },
        props: { imageFill: { mode: "cover", assetId: null } },
        extra: { listSlot: "itemTemplate" },
        valueBindings: {
            "imageFill.assetId": { kind: "blueprintValue", blueprintId: "bp-value", valueType: "string" },
        },
    };
    return document;
}

function rendererRegistry(): ElementRendererRegistry {
    return new ElementRendererRegistry([
        { type: "nl.root", render: props => <>{props.children}</> },
        { type: "nl.text", render: props => <span>[{String(props.element.props?.text ?? "")}]</span> },
        {
            type: "nl.image",
            render: props => (
                <span>
                    [{String((props.element.props?.imageFill as { assetId?: unknown } | undefined)?.assetId ?? "")}]
                </span>
            ),
        },
        { type: "nl.list", render: props => <ListRenderer {...props} /> },
    ]);
}

function hostAdapter(): UIHostAdapter {
    return {
        host: "app",
        blueprintRuntime: {
            surfaceId: SURFACE_ID,
            runtimeScopeId: SCOPE_ID,
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {},
        },
    } as unknown as UIHostAdapter;
}

function bindingContext(blueprintDocument: BlueprintDocument): SurfaceBlueprintBindingContext {
    return {
        blueprintDocument,
        persistentVariables: {},
        surfaceState: new SurfaceStateStore(SCOPE_ID),
        debug: new DebugBridge(),
        coalescer: new BindingDebugCoalescer(),
        globalState: { get: () => undefined, subscribe: () => () => undefined },
    };
}

function mount(document: UIDocument, blueprintDocument: BlueprintDocument) {
    return render(
        <StrictMode>
            <SurfaceElementTree
                document={document}
                surface={surface}
                rootElement={document.elements.root!}
                rendererRegistry={rendererRegistry()}
                hostAdapter={hostAdapter()}
                blueprintBindingContext={bindingContext(blueprintDocument)}
                editorChrome={false}
            />
        </StrictMode>,
    );
}

/** Blueprint Value evaluation is async; drain microtasks/timers until the tree settles. */
async function settle(): Promise<void> {
    for (let i = 0; i < 12; i += 1) {
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    }
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

/** Rendered text of every `nl.text` widget, in document order (the list injects a `<style>` tag). */
function renderedTexts(container: HTMLElement): string[] {
    return [...container.querySelectorAll("span")].map(node => node.textContent ?? "");
}

describe("Blueprint Value bindings on a mounted surface", () => {
    it("replaces the authored prop with the evaluated value", async () => {
        const document = plainTextDocument();
        const view = mount(
            document,
            valueBlueprintDocument({ blueprintId: "bp-value", elementId: "text", graph: literalGraph("PROBE") }),
        );
        await settle();

        expect(renderedTexts(view.container)).toEqual(["[PROBE]"]);
    });

    it("gives every list row its own item field instead of one shared value", async () => {
        const document = listDocument([
            { id: "a", line: "First line" },
            { id: "b", line: "Second line" },
            { id: "c", line: "Third line" },
        ]);
        const view = mount(
            document,
            valueBlueprintDocument({ blueprintId: "bp-value", elementId: "row", graph: listItemFieldGraph("line") }),
        );
        await settle();

        expect(renderedTexts(view.container)).toEqual(["[First line]", "[Second line]", "[Third line]"]);
    });

    /**
     * A picture arrives as `{kind:"imageAsset",assetId}` from every node that hands one out - the
     * save preview, a gallery cover, another widget's fill - while `imageFill.assetId` is a bare id
     * and so declares itself `string`. Stringifying the envelope wrote "[object Object]" onto the
     * widget, which names no asset: the picture was blank, and because a missing asset is drawn as
     * nothing rather than reported, neither the console nor the issues panel said a word.
     */
    it("hands a picture to the widget as an asset id, not as its envelope", async () => {
        const document = imageListDocument([
            { id: "a", art: { kind: "imageAsset", assetId: "asset-1" } },
            { id: "b", art: { kind: "imageAsset", assetId: "asset-2" } },
        ]);
        const view = mount(
            document,
            valueBlueprintDocument({
                blueprintId: "bp-value",
                elementId: "row",
                propPath: "imageFill.assetId",
                graph: imageAssetGraph("art"),
            }),
        );
        await settle();

        expect(renderedTexts(view.container)).toEqual(["[asset-1]", "[asset-2]"]);
    });
});
