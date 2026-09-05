// @vitest-environment jsdom
/**
 * What a memoised element tree is still guaranteed to show.
 *
 * `SurfaceElementTreeContent` reuses the tree it built last time whenever every prop is identical,
 * which is what keeps a page switch from rebuilding hundreds of widgets a dozen times over. The
 * catch is that the walk also reads a store no prop can see: a `widgetProp` binding is answered out
 * of the surface state store while the tree is being built. `hostRenderTick` is the host promising
 * to say when that store moved, and these tests hold both halves of the promise:
 *
 * - a host that makes it gets its bound widgets updated,
 * - a host that does not make it is not memoised at all, rather than quietly freezing.
 */
import { render, cleanup, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { SurfaceStateStore } from "@/lib/ui-editor/blueprint-runtime/SurfaceStateStore";
import { SurfaceElementTree, type SurfaceBlueprintBindingContext } from "./SurfaceElementTree";

const SURFACE_ID = "surface";

/**
 * A widget type of this test's own, because the four that carry the shared appearance model take
 * only a `variant` binding - see `appearanceCapableWidgets` - and what is under test here is an
 * ordinary prop arriving from state.
 */
const PROBE_TYPE = "nl.test.probe";

const surface: UISurface = {
    id: SURFACE_ID,
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 240 },
    rootElementId: "root",
};

function uiDocument(): UIDocument {
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
                childrenIds: ["probe"],
                layout: { x: 0, y: 0, width: 320, height: 240 },
            },
            probe: {
                id: "probe",
                type: PROBE_TYPE,
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 40 },
                props: { caption: "AUTHORED" },
            },
        },
    };
}

/** One blueprint whose field reads a surface state key, bound to the probe's `caption`. */
function blueprintDocument(): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        ownerRecords: {},
        blueprints: {
            main: {
                id: "main",
                name: "Main",
                owner: { kind: "globalMain" },
                graphs: { events: {}, functions: {} },
                members: {
                    variables: {},
                    functions: {},
                    fields: {
                        caption: {
                            id: "caption",
                            name: "Caption",
                            valueSource: { kind: "surfaceState", key: "caption" },
                        },
                    },
                },
                bindings: {
                    b1: {
                        id: "b1",
                        target: { kind: "widgetProp", surfaceId: SURFACE_ID, elementId: "probe", propPath: "caption" },
                        source: { kind: "field", blueprintId: "main", fieldId: "caption" },
                        mode: "replace",
                    },
                },
            },
        },
    };
}

function rendererRegistry(): ElementRendererRegistry {
    return new ElementRendererRegistry([
        { type: "nl.root", render: props => <>{props.children}</> },
        { type: PROBE_TYPE, render: props => <span>[{String(props.element.props?.caption ?? "")}]</span> },
    ]);
}

function hostAdapter(): UIHostAdapter {
    return {
        host: "app",
        blueprintRuntime: {
            surfaceId: SURFACE_ID,
            runtimeScopeId: "scope-1",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {},
        },
    } as unknown as UIHostAdapter;
}

function bindingContext(surfaceState: SurfaceStateStore): SurfaceBlueprintBindingContext {
    return {
        blueprintDocument: blueprintDocument(),
        persistentVariables: {},
        surfaceState,
        debug: new DebugBridge(),
        coalescer: new BindingDebugCoalescer(),
        globalState: { get: () => undefined, subscribe: () => () => undefined },
    };
}

function caption(container: HTMLElement): string {
    return container.querySelector("span")?.textContent ?? "";
}

afterEach(() => cleanup());

describe("a memoised surface tree and the store it reads", () => {
    function mount(input: { hostRenderTick?: number; surfaceState: SurfaceStateStore; context: SurfaceBlueprintBindingContext }) {
        const document = uiDocument();
        const registry = rendererRegistry();
        const adapter = hostAdapter();
        const tree = (hostRenderTick?: number) => (
            <SurfaceElementTree
                document={document}
                surface={surface}
                rootElement={document.elements.root!}
                rendererRegistry={registry}
                hostAdapter={adapter}
                blueprintBindingContext={input.context}
                editorChrome={false}
                staticDocument
                {...(hostRenderTick === undefined ? {} : { hostRenderTick })}
            />
        );
        const view = render(tree(input.hostRenderTick));
        return { view, tree };
    }

    it("shows a state write when the host reports it through the tick", async () => {
        const surfaceState = new SurfaceStateStore("scope-1");
        surfaceState.set("caption", "FIRST");
        const context = bindingContext(surfaceState);
        const { view, tree } = mount({ hostRenderTick: 0, surfaceState, context });
        expect(caption(view.container)).toBe("[FIRST]");

        await act(async () => {
            surfaceState.set("caption", "SECOND");
        });
        // What `GameSurfaceRenderer` does on that store's notification: bump the tick and re-render.
        view.rerender(tree(1));

        expect(caption(view.container)).toBe("[SECOND]");
    });

    it("is not memoised at all when the host promises nothing", async () => {
        // The failure this prevents is silent: a page whose bound widgets stop updating, with every
        // prop identical and nothing to say the store moved.
        const surfaceState = new SurfaceStateStore("scope-1");
        surfaceState.set("caption", "FIRST");
        const context = bindingContext(surfaceState);
        const { view, tree } = mount({ surfaceState, context });
        expect(caption(view.container)).toBe("[FIRST]");

        await act(async () => {
            surfaceState.set("caption", "SECOND");
        });
        view.rerender(tree(undefined));

        expect(caption(view.container)).toBe("[SECOND]");
    });

    it("reuses the tree when every input really is identical", async () => {
        // The other half of the bargain: a re-render that changed nothing must not rebuild, which is
        // what the whole memo exists for.
        let renders = 0;
        const surfaceState = new SurfaceStateStore("scope-1");
        surfaceState.set("caption", "FIRST");
        const context = bindingContext(surfaceState);
        const document = uiDocument();
        const registry = new ElementRendererRegistry([
            { type: "nl.root", render: props => <>{props.children}</> },
            {
                type: PROBE_TYPE,
                render: props => {
                    renders += 1;
                    return <span>[{String(props.element.props?.caption ?? "")}]</span>;
                },
            },
        ]);
        const adapter = hostAdapter();
        const tree = (
            <SurfaceElementTree
                document={document}
                surface={surface}
                rootElement={document.elements.root!}
                rendererRegistry={registry}
                hostAdapter={adapter}
                blueprintBindingContext={context}
                editorChrome={false}
                staticDocument
                hostRenderTick={0}
            />
        );
        const view = render(tree);
        const afterMount = renders;

        view.rerender(tree);

        expect(renders).toBe(afterMount);
        expect(caption(view.container)).toBe("[FIRST]");
    });
});
