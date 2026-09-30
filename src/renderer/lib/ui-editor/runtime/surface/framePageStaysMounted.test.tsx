// @vitest-environment jsdom
/**
 * A page drawn in a Page widget is mounted once, and stays mounted while the page around it redraws.
 *
 * The nested page's runtime is keyed on the frame's own record, the surface it is drawn on and its
 * params - and each of those arrived as a new object on every pass of the tree above (the frame is
 * cloned per pass, a component's surface is rebuilt per drawing). So every redraw of the outer page -
 * any write a graph made to it - tore the framed page down and put it back: its scope closed,
 * cancelling whatever its graphs were running, and its Surface Init ran again. Measured in Dev Mode:
 * five framed pages, three presses of a button that retitles the outer page, thirty-one more Surface
 * Inits.
 *
 * A frame with an animation of its own was worse: normalising the animation built a new object on
 * every render, an effect keyed on it set state, and the page was drawn again without end.
 *
 * Comments in English per project convention.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { ElementRendererRegistry, type ElementRendererDefinition } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { SurfaceElementTree, type NestedSurfaceRuntime, type NestedSurfaceRuntimeInput } from "./SurfaceElementTree";

function element(
    id: string,
    type: string,
    parentId: string | null,
    childrenIds: string[],
    props?: Record<string, unknown>,
    extra?: Record<string, unknown>,
): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 200, height: 100 },
        ...(props ? { props } : {}),
        ...(extra ? { extra } : {}),
    };
}

/** A host page with a frame of its own and a card placement whose definition holds another. */
function documentWith(frameProps: Record<string, unknown>): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: "host", name: "Host", host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: "root" },
            { id: "child", name: "Child", host: "app", kind: "appSurface", designSize: { width: 200, height: 100 }, rootElementId: "childRoot" },
        ],
        elements: {
            root: element("root", "nl.root", null, ["frame", "card"]),
            frame: element("frame", "nl.frame", "root", [], { targetSurfaceId: "child", ...frameProps }),
            card: element("card", "nl.container", "root", [], undefined, { componentLink: { componentId: "cardDef", linked: true } }),
            childRoot: element("childRoot", "nl.root", null, ["probe"]),
            probe: element("probe", "test.probe", "childRoot", []),
        },
        components: [
            {
                id: "cardDef",
                name: "Card",
                rootElementId: "cardRoot",
                elements: {
                    cardRoot: element("cardRoot", "nl.container", null, ["window"]),
                    window: element("window", "nl.frame", "cardRoot", [], { targetSurfaceId: "child", ...frameProps }),
                },
            },
        ],
    };
}

const hostAdapter = {
    host: "app",
    blueprintRuntime: {
        surfaceId: "host",
        runtimeScopeId: "host-scope",
        setSurfaceState: () => undefined,
        getSurfaceState: () => undefined,
        emitDebug: () => undefined,
        dispatchElementBlueprintEvent: async () => undefined,
    },
} as unknown as UIHostAdapter;

let pageDraws = 0;
const probe: ElementRendererDefinition = {
    type: "test.probe",
    render: () => {
        pageDraws += 1;
        // Far more than any number of honest redraws here; a loop reaches it within a second.
        if (pageDraws > 500) {
            throw new Error("the framed page is being drawn without end");
        }
        return <span />;
    },
};
const registry = new ElementRendererRegistry([...BuiltinElementRenderers, probe]);

function countingRuntime() {
    const mounts: string[] = [];
    const unmounts: string[] = [];
    const inputs: NestedSurfaceRuntimeInput[] = [];
    const runtime: NestedSurfaceRuntime = {
        createHostAdapter: input => {
            inputs.push(input);
            return { host: "app" };
        },
        mountSurface: input => {
            mounts.push(input.frameElement.id);
            return () => {
                unmounts.push(input.frameElement.id);
            };
        },
    };
    return { runtime, mounts, unmounts, inputs };
}

function tree(document: UIDocument, runtime: NestedSurfaceRuntime, tick: number) {
    return (
        <WidgetRuntimeStateProvider>
            <SurfaceElementTree
                document={document}
                surface={document.surfaces[0]!}
                rootElement={document.elements.root!}
                rendererRegistry={registry}
                hostAdapter={hostAdapter}
                nestedSurfaceRuntime={runtime}
                hostRenderTick={tick}
            />
        </WidgetRuntimeStateProvider>
    );
}

const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

beforeAll(() => {
    installResizeObserverStub();
});

afterEach(() => {
    cleanup();
    pageDraws = 0;
});

describe("a page drawn in a Page widget", () => {
    it("stays mounted while the page around it redraws, on a page and inside a component", async () => {
        const { runtime, mounts, unmounts } = countingRuntime();
        const document = documentWith({});
        const view = render(tree(document, runtime, 0));
        await waitFor(() => expect([...mounts].sort()).toEqual(["frame", "window"]));

        // What a graph writing to the outer page does: the host says the tree must be walked again.
        for (let tick = 1; tick <= 5; tick++) {
            view.rerender(tree(document, runtime, tick));
            await settle();
        }

        expect([...mounts].sort()).toEqual(["frame", "window"]);
        expect(unmounts).toEqual([]);
    });

    it("is still handed the frame's params when they really change", async () => {
        const { runtime, inputs } = countingRuntime();
        const view = render(tree(documentWith({ params: { chapter: "one" } }), runtime, 0));
        await waitFor(() => expect(inputs.length).toBeGreaterThan(0));

        view.rerender(tree(documentWith({ params: { chapter: "two" } }), runtime, 1));

        await waitFor(() => {
            const latest = inputs.filter(input => input.frameElement.id === "frame").at(-1);
            expect(latest?.params).toEqual({ chapter: "two" });
        });
    });

    it("settles when the frame has an animation of its own", async () => {
        const { runtime } = countingRuntime();
        const animation = { enter: "fade", exit: "fade", enterDurationSeconds: 0.2, exitDurationSeconds: 0.2 };
        render(tree(documentWith({ animation }), runtime, 0));
        // Past the page's own enter, which redraws it a few honest times on the way in.
        await settle(600);
        const drawn = pageDraws;

        await settle(300);

        expect(pageDraws).toBe(drawn);
    });
});
