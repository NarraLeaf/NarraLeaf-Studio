// @vitest-environment jsdom
/**
 * An entry that loses pointer input and is handed it back must be clickable again.
 *
 * Deliberately a component test rather than one over the input-resolution rules. Those rules were
 * always right about which entry should take input; what went wrong lived in this component, where
 * "has arrived" was kept in the same flag as "takes input" - so a flag that only a once-per-entry
 * arrival callback could raise was being lowered every time something above the entry took input
 * away. Any test that could see it has to render the component and toggle that input across it.
 *
 * The animation layer is stubbed so arrival is driven rather than waited for, and so the assertion
 * can read the interactivity the layer is actually rendered with. The stub fires arrival once, which
 * is what the real one does: it reports enter-complete a single time per key.
 */
import { act, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    createRecordingCore,
    ensureAnimationFramePolyfill,
    makeBlueprintHostAdapter,
    makeTestSurface,
} from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { SurfaceLifecycleOrchestrator } from "./lifecycle/surfaceLifecycleOrchestrator";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";
import type { HostAdapterBundle } from "./types";

const hoisted = vi.hoisted(() => ({
    enterComplete: null as ((entryKey: string) => void) | null,
}));

vi.mock("@/lib/ui-editor/runtime/surface/SurfaceAnimationLayer", () => ({
    SurfaceAnimationLayer: (props: {
        interactive?: boolean;
        onEnterComplete?: (entryKey: string) => void;
        children: ReactNode;
    }) => {
        hoisted.enterComplete = props.onEnterComplete ?? null;
        return (
            <div data-testid="animation-layer" data-interactive={String(props.interactive === true)}>
                {props.children}
            </div>
        );
    },
}));

vi.mock("@/lib/ui-editor/runtime/surface/GameSurfaceRenderer", () => ({
    GameSurfaceRenderer: (props: { interactive?: boolean }) => (
        <div data-testid="surface-renderer" data-interactive={String(props.interactive === true)} />
    ),
}));

import { AppSurfaceLayer, type AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";

const ENTRY_KEY = "entry-1";

const uidoc = { elements: {} } as unknown as UIDocument;
const blueprintDocument = { blueprints: [] } as unknown as BlueprintDocument;

function makeEntry(key: string): AppSurfaceLayerNavEntry {
    return {
        key,
        surfaceId: "surface-a",
        direction: "forward",
        waitForExit: false,
        props: {},
        presentation: "appPage",
        runtimeScopeId: "scope-1",
    };
}

/** What the layer, and the surface renderer under it, are currently rendered as taking input. */
function readInteractive(): { layer: string | undefined; renderer: string | undefined } {
    return {
        layer: screen.getByTestId("animation-layer").dataset.interactive,
        renderer: screen.getByTestId("surface-renderer").dataset.interactive,
    };
}

function mountLayer() {
    const readyReports: Array<{ entryKey: string; ready: boolean }> = [];
    const entry = makeEntry(ENTRY_KEY);
    const surface: UISurface = makeTestSurface("surface-a");
    const core = createRecordingCore([]);
    const widgetRuntimeStore = new WidgetRuntimeStateStore();
    const lifecycleRef = { current: new SurfaceLifecycleOrchestrator() };
    const widgetPatchesByScopeRef = { current: {} as WidgetPatchesByScope };
    const hostAdapterBundle: HostAdapterBundle = {
        hostAdapter: makeBlueprintHostAdapter(),
        bindingContext: {} as HostAdapterBundle["bindingContext"],
        runtimeScopeId: "scope-1",
    };
    // Stable identities: the readiness report is an effect keyed on its own callback, and a fresh
    // arrow per render would fire it again on every render and hide whether a real edge was crossed.
    const onInteractionReadyChange = (entryKey: string, ready: boolean) => {
        readyReports.push({ entryKey, ready });
    };
    const noop = () => undefined;

    const element = (active: boolean) => (
        <AppSurfaceLayer
            uidoc={uidoc}
            blueprintDocument={blueprintDocument}
            persistentVariables={{} as PersistentVariableRuntimeTable}
            core={core}
            entry={entry}
            layerIndex={0}
            surface={surface}
            rendererRegistry={{} as ElementRendererRegistry}
            scale={1}
            hostAdapterBundle={hostAdapterBundle}
            widgetPatchesByScope={{}}
            widgetPatchesByScopeRef={widgetPatchesByScopeRef}
            widgetRuntimeStore={widgetRuntimeStore}
            lifecycleRef={lifecycleRef}
            blueprintLifecycleReady
            reducedMotion
            active={active}
            keyboardOwner={active}
            onInteractionReadyChange={onInteractionReadyChange}
            onPrepaintReady={noop}
            onEnterComplete={noop}
        />
    );

    const { rerender } = render(element(true));
    return {
        readyReports,
        setActive: (active: boolean) => {
            act(() => {
                rerender(element(active));
            });
        },
        /** Arrival, exactly once - the real animation layer reports it once per entry key. */
        finishEnter: () => {
            act(() => {
                hoisted.enterComplete?.(ENTRY_KEY);
            });
        },
    };
}

beforeAll(() => {
    ensureAnimationFramePolyfill();
    // Without this, `act` does not flush effects and every assertion below would be reading a render
    // that never settled - which passes just as readily as a correct one.
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    cleanup();
    hoisted.enterComplete = null;
});

describe("AppSurfaceLayer interactivity across an inert round trip", () => {
    it("is inert until it has arrived", () => {
        mountLayer();
        expect(readInteractive()).toEqual({ layer: "false", renderer: "false" });
    });

    it("takes input once it has arrived", () => {
        const layer = mountLayer();
        layer.finishEnter();
        expect(readInteractive()).toEqual({ layer: "true", renderer: "true" });
    });

    it("takes input again after a layer above it hands input back", () => {
        const layer = mountLayer();
        layer.finishEnter();

        layer.setActive(false);
        expect(readInteractive()).toEqual({ layer: "false", renderer: "false" });

        // No second arrival: this entry never left, so nothing re-runs its enter animation. Before
        // arrival and input were told apart, this is where the entry stayed unclickable for good.
        layer.setActive(true);
        expect(readInteractive()).toEqual({ layer: "true", renderer: "true" });
    });

    it("reports readiness to the host in both directions", () => {
        const layer = mountLayer();
        layer.finishEnter();
        layer.setActive(false);
        layer.setActive(true);

        expect(layer.readyReports.every(report => report.entryKey === ENTRY_KEY)).toBe(true);
        expect(layer.readyReports.map(report => report.ready)).toEqual([false, true, false, true]);
    });
});
