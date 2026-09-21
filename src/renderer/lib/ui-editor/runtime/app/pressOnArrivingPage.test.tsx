// @vitest-environment jsdom
/**
 * A press on a page that is still fading in reaches the page.
 *
 * A title screen fading in is exactly when a player presses Start, and a press made before the
 * page's enter animation had finished used to vanish: the button was on screen and was hit, but no
 * handler was attached to it until the animation reported complete, so nothing was dispatched,
 * nothing was queued and nothing was reported. In Dev Mode the story boots behind the title, and
 * under that load the wait stretched to 0.2-0.6 s after the title's first frame - so the first press
 * of anyone quick did nothing at all. A page inside a frame had the same rule and the same hole.
 *
 * These render the real page layer (or the real frame), the real animation layer, the real element
 * tree and the real button, with a page animation long enough to press inside, and assert on what
 * the page's runtime receives. Each press is made after the page is revealed and checked to be
 * before its arrival: a press that happened to land after the arrival would pass without testing
 * anything.
 *
 * The other edge of the same rule is pinned too: a page on its way out takes no press. It is still
 * drawn, with the props it had as the page input went to, so nothing but the presence group says it
 * is leaving.
 */
import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { createRecordingCore, ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { blueprintDocumentOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import { SurfaceLifecycleOrchestrator } from "./lifecycle/surfaceLifecycleOrchestrator";
import { AppSurfaceLayer, type AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";
import type { HostAdapterBundle } from "./types";

/** A project with no blueprints: the page runs its lifecycle, and nothing answers it but the recorder. */
const NO_BLUEPRINTS = blueprintDocumentOf([]);

/** Long enough that a press made just after the reveal, or just after leaving, lands inside the fade. */
const FADE = {
    ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
    enter: "fade" as const,
    enterDurationSeconds: 1,
    exit: "fade" as const,
    exitDurationSeconds: 1,
};

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 60 }, ...more };
}

function surfaceOf(id: string, rootElementId: string): UISurface {
    return {
        id,
        name: id,
        host: "app",
        kind: "appSurface",
        designSize: { width: 640, height: 360 },
        rootElementId,
        settings: { pageAnimation: FADE },
    } as UISurface;
}

/**
 * A title page with a Start button, and a page with a frame onto a menu that holds a Load button.
 * The title and the menu both fade in, so both have a window between being revealed and arriving.
 */
const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surfaceOf("title", "titleRoot"), surfaceOf("host", "hostRoot"), surfaceOf("menu", "menuRoot")],
    elements: {
        titleRoot: element("titleRoot", "nl.root", null, ["start"]),
        start: element("start", "nl.button", "titleRoot", [], { props: { label: "Start" } }),
        hostRoot: element("hostRoot", "nl.root", null, ["frame"]),
        frame: element("frame", "nl.frame", "hostRoot", [], {
            layout: { x: 0, y: 0, width: 640, height: 360 },
            props: { targetSurfaceId: "menu" },
        }),
        menuRoot: element("menuRoot", "nl.root", null, ["load"]),
        load: element("load", "nl.button", "menuRoot", [], { props: { label: "Load" } }),
    },
} as unknown as UIDocument;

/** A page runtime that records what reaches it: element events, and the page's own lifecycle events. */
function recordingPage(surfaceId: string, runtimeScopeId: string) {
    const elementEvents: Array<{ elementId: string; eventName: string }> = [];
    const surfaceEvents: string[] = [];
    const adapter = {
        host: "app",
        blueprintRuntime: {
            surfaceId,
            runtimeScopeId,
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async (elementId: string, eventName: string) => {
                elementEvents.push({ elementId, eventName });
            },
            dispatchSurfaceBlueprintEvent: async (eventName: string) => {
                surfaceEvents.push(eventName);
            },
        },
    } as unknown as UIHostAdapter;
    return {
        adapter,
        surfaceEvents,
        clicksOn: (elementId: string) =>
            elementEvents.filter(event => event.elementId === elementId && event.eventName === "mouseClick").length,
        /** What `Is Surface Entering` would answer right now, which is the page's own account of it. */
        isEntering: () => adapter.blueprintRuntime?.getSurfaceTransitionState?.().isEntering === true,
    };
}

/** The label a button draws, which is what a player aims at. */
function labelNode(container: HTMLElement, label: string): HTMLElement {
    const node = Array.from(container.querySelectorAll<HTMLElement>("*"))
        .filter(candidate => candidate.children.length === 0)
        .find(candidate => candidate.textContent?.trim() === label);
    if (!node) {
        throw new Error(`no "${label}" on screen`);
    }
    return node;
}

/** Let the render a reveal schedules commit, as it has by the time a player's press arrives. */
async function settle(): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
    });
}

beforeAll(() => {
    ensureAnimationFramePolyfill();
    installResizeObserverStub();
    // Without this, `act` does not flush effects and the press would be made on a render that never
    // settled - which passes or fails for reasons that have nothing to do with the press.
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => cleanup());

/**
 * The host half of the page layer, played as the game app plays it: the page is drawn in a presence
 * group, the reveal is recorded when the layer reports its prepaint, and that record is what the
 * layer is handed back. Taking the page away plays it out with the props it last had.
 */
function TitleHost(props: { hostAdapterBundle: HostAdapterBundle; onRevealed: () => void; shown?: boolean }) {
    const [revealed, setRevealed] = useState(false);
    const [lifecycleRef] = useState(() => ({ current: new SurfaceLifecycleOrchestrator() }));
    const [widgetRuntimeStore] = useState(() => new WidgetRuntimeStateStore());
    const [widgetPatchesByScopeRef] = useState(() => ({ current: {} as WidgetPatchesByScope }));
    const [core] = useState(() => createRecordingCore([]));
    const [registry] = useState(() => new ElementRendererRegistry(BuiltinElementRenderers));
    const entry: AppSurfaceLayerNavEntry = {
        key: "title-entry",
        surfaceId: "title",
        direction: "forward",
        waitForExit: false,
        props: {},
        presentation: "appPage",
        runtimeScopeId: props.hostAdapterBundle.runtimeScopeId,
    };
    return (
        <AnimatePresence initial={false}>
            {props.shown === false ? null : (
                <AppSurfaceLayer
                    key={entry.key}
                    uidoc={document}
                    blueprintDocument={NO_BLUEPRINTS}
                    persistentVariables={{} as PersistentVariableRuntimeTable}
                    core={core}
                    entry={entry}
                    layerIndex={0}
                    surface={document.surfaces[0]!}
                    rendererRegistry={registry}
                    scale={1}
                    hostAdapterBundle={props.hostAdapterBundle}
                    widgetPatchesByScope={{}}
                    widgetPatchesByScopeRef={widgetPatchesByScopeRef}
                    widgetRuntimeStore={widgetRuntimeStore}
                    lifecycleRef={lifecycleRef}
                    blueprintLifecycleReady={revealed}
                    reducedMotion={false}
                    active
                    keyboardOwner
                    onPrepaintReady={() => {
                        setRevealed(true);
                        props.onRevealed();
                    }}
                    onEnterComplete={() => undefined}
                />
            )}
        </AnimatePresence>
    );
}

describe("a press on a page that is still fading in", () => {
    it("reaches the page's button", async () => {
        const page = recordingPage("title", "title-scope");
        let revealed = false;
        const { container } = render(
            <TitleHost
                hostAdapterBundle={{
                    hostAdapter: page.adapter,
                    bindingContext: null as unknown as HostAdapterBundle["bindingContext"],
                    runtimeScopeId: "title-scope",
                }}
                onRevealed={() => {
                    revealed = true;
                }}
            />,
        );
        await waitFor(() => expect(revealed).toBe(true));
        await settle();

        const enteringAtPress = page.isEntering();
        const arrivedBeforePress = page.surfaceEvents.includes("afterSurfaceEnter");
        fireEvent.click(labelNode(container, "Start"));

        expect({ enteringAtPress, arrivedBeforePress }).toEqual({ enteringAtPress: true, arrivedBeforePress: false });
        await waitFor(() => expect(page.clicksOn("start")).toBe(1));
    });

    it("reaches a button on a page inside a frame", async () => {
        const menus: Array<ReturnType<typeof recordingPage>> = [];
        const host = recordingPage("host", "host-scope");
        const { container } = render(
            <WidgetRuntimeStateProvider>
                <SurfaceElementTree
                    document={document}
                    surface={document.surfaces[1]!}
                    rootElement={document.elements.hostRoot!}
                    rendererRegistry={new ElementRendererRegistry(BuiltinElementRenderers)}
                    hostAdapter={host.adapter}
                    editorChrome={true}
                    nestedSurfaceRuntime={{
                        createHostAdapter: input => {
                            const menu = recordingPage(input.targetSurface.id, input.runtimeScopeId);
                            menus.push(menu);
                            return menu.adapter;
                        },
                    }}
                />
            </WidgetRuntimeStateProvider>,
        );
        await waitFor(() =>
            expect(
                container.querySelector("[data-ui-surface-id='menu'][data-ui-surface-prepaint]")?.getAttribute("data-ui-surface-prepaint"),
            ).toBe("ready"),
        );
        await settle();
        const menu = menus[menus.length - 1]!;

        const enteringAtPress = menu.isEntering();
        const arrivedBeforePress = menu.surfaceEvents.includes("afterSurfaceEnter");
        fireEvent.click(labelNode(container, "Load"));

        expect({ enteringAtPress, arrivedBeforePress }).toEqual({ enteringAtPress: true, arrivedBeforePress: false });
        await waitFor(() => expect(menu.clicksOn("load")).toBe(1));
    });
});

describe("a press on a page on its way out", () => {
    it("does not reach the page, although the page is still on screen", async () => {
        const page = recordingPage("title", "title-scope");
        const hostAdapterBundle: HostAdapterBundle = {
            hostAdapter: page.adapter,
            bindingContext: null as unknown as HostAdapterBundle["bindingContext"],
            runtimeScopeId: "title-scope",
        };
        let revealed = false;
        const onRevealed = () => {
            revealed = true;
        };
        const view = render(<TitleHost hostAdapterBundle={hostAdapterBundle} onRevealed={onRevealed} />);
        await waitFor(() => expect(revealed).toBe(true));
        await settle();

        // Gone from the stack, still fading out - drawn with the props it had when it was the page
        // input went to.
        view.rerender(<TitleHost hostAdapterBundle={hostAdapterBundle} onRevealed={onRevealed} shown={false} />);
        await waitFor(() => expect(page.surfaceEvents).toContain("beforeSurfaceExit"));
        await settle();
        const start = labelNode(view.container, "Start");
        fireEvent.click(start);
        await settle();

        expect(start.isConnected).toBe(true);
        expect(page.clicksOn("start")).toBe(0);
    });
});
