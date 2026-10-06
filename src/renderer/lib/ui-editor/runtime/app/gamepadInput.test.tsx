// @vitest-environment jsdom
/**
 * A gamepad press goes the way a key goes: the global blueprint, then the page that owns the keys,
 * then the controls on it - and a global head that stops the press keeps it from both.
 *
 * Measured in a running game, a key is heard by the global's key heads, then by the keyboard owner's,
 * then by every widget key head listening on `window`, and a global script that stops the key keeps
 * it from the page and the widgets alike. A pad press used to reach the widgets first, straight off
 * the poller, each with an event control of its own - so the same global stop that silenced a widget
 * for a key did nothing for a button. These pin the key's order on the pad.
 *
 * What runs is what a game runs short of React around the whole of it: the real poller over a fake
 * pad, the listener `GameApp` installs, the per-entry host, the real nodes and dispatcher, and the
 * page drawn by the real surface renderer, so the control's head is reached the way a mounted
 * widget's is. What is asserted is which heads answered, and in what order.
 *
 * Comments in English per project convention.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_PARAM_EVENT_HEAD_GAMEPAD_BUTTON } from "@shared/types/blueprint/gamepad";
import { BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAMEPAD_BUTTON_DOWN, BLUEPRINT_NODE_TYPE_LOG } from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { scriptLayerKey } from "@shared/blueprint/blueprintLayers";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { mountCompiledScripts, unmountCompiledScripts } from "@/lib/ui-editor/blueprint-runtime/script/scriptRuntime";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { WidgetRuntimeScopeProvider, WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { listenAsGamepadControl, resetGamepadControls } from "@/lib/ui-editor/runtime/input/gamepadControls";
import { resetSharedGamepadTracker, setGamepadTrackerHost, type UIGamepadHost } from "@/lib/ui-editor/runtime/input/gamepadState";
import { resetSharedInputHoldTracker } from "@/lib/ui-editor/runtime/input/inputHoldState";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import { createRecordingCore } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { blueprintDocumentOf, graphOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import type { AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";
import type { GameHostCapabilities } from "./gameHostApiOptions";
import { listenForGamepads } from "./gamepadInput";
import { buildPageHostAdapterBundle, cacheHostAdapterBundles, type PageHostInputs } from "./hostAdapterBundles";
import type { KeyboardOwner } from "./keyboardOwner";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";

const PAGE = "page";
const CONTROL = "page-button";
const SCRIPT_LAYER = "layer-script";
/** Standard-mapping indices of the two buttons used here. */
const BUTTON_INDEX = { A: 0, Y: 3 } as const;
type Button = keyof typeof BUTTON_INDEX;

const pageSurface: UISurface = {
    id: PAGE,
    name: PAGE,
    host: "app",
    kind: "appSurface",
    designSize: { width: 640, height: 360 },
    rootElementId: `${PAGE}-root`,
};

const uiDocument: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [pageSurface],
    elements: {
        [`${PAGE}-root`]: {
            id: `${PAGE}-root`,
            type: "nl.root",
            parentId: null,
            childrenIds: [CONTROL],
            layout: { x: 0, y: 0, width: 640, height: 360, visible: true },
        },
        [CONTROL]: {
            id: CONTROL,
            type: "nl.button",
            parentId: `${PAGE}-root`,
            childrenIds: [],
            layout: { x: 20, y: 20, width: 120, height: 40, visible: true },
        },
    },
};

/** A head for one button that logs `<who>: <button>`. */
function heardBy(who: string, button: Button) {
    return graphOf({
        nodes: {
            head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAMEPAD_BUTTON_DOWN, params: { [BLUEPRINT_NODE_PARAM_EVENT_HEAD_GAMEPAD_BUTTON]: button } },
            say: { type: "blueprint.data.stringLiteral", params: { value: `${who}: ${button}` } },
            log: { type: BLUEPRINT_NODE_TYPE_LOG },
        },
        exec: ["head", "log"],
        data: [["say", "value", "log", "value"]],
    });
}

function blueprintOn(id: string, owner: BlueprintOwnerRef, layers: Record<string, ReturnType<typeof graphOf> | "script">): Blueprint {
    return {
        id,
        name: id,
        owner,
        members: { variables: {}, fields: {}, functions: {} },
        bindings: {},
        graphs: {
            events: Object.fromEntries(Object.entries(layers).map(([layerId, layer]) => [
                layerId,
                layer === "script" ? { id: layerId, script: { scriptRef: `scripts/${id}.ts` } } : { id: layerId, graph: layer },
            ])),
            functions: {},
        },
    } as unknown as Blueprint;
}

/** A standard pad whose buttons the test holds down and lets go, and a frame loop it steps by hand. */
function fakePad() {
    const pressed = new Set<number>();
    const frames: FrameRequestCallback[] = [];
    const pad = () => ({
        index: 0,
        id: "test-pad",
        mapping: "standard",
        connected: true,
        timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.has(index), touched: pressed.has(index), value: pressed.has(index) ? 1 : 0 })),
    }) as unknown as Gamepad;
    const host: UIGamepadHost = {
        getGamepads: () => [pad()],
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        requestAnimationFrame: callback => frames.push(callback),
        cancelAnimationFrame: () => undefined,
        visibilityState: "visible",
        hasFocus: () => true,
    };
    const tick = () => frames.at(-1)?.(0);
    return {
        host,
        /** Down for one frame, up on the next. */
        press(button: Button) {
            pressed.add(BUTTON_INDEX[button]);
            tick();
            pressed.delete(BUTTON_INDEX[button]);
            tick();
        },
        tick,
    };
}

const running: Array<() => void> = [];

/** Let every graph a press started run to the end. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 3; turn++) {
        await new Promise(resolve => setTimeout(resolve, 30));
    }
}

/**
 * A game showing one page with a control on it, the pad listener `GameApp` installs, and a global
 * blueprint with a script layer that stops Y.
 */
async function runningGame() {
    const blueprintDocument = blueprintDocumentOf([
        blueprintOn("bp-global", { kind: "globalMain" }, {
            a: heardBy("global", "A"),
            y: heardBy("global", "Y"),
            [SCRIPT_LAYER]: "script",
        }),
        blueprintOn("bp-page", { kind: "surfaceMain", surfaceId: PAGE }, {
            a: heardBy("page", "A"),
            y: heardBy("page", "Y"),
        }),
        blueprintOn("bp-control", { kind: "widgetMain", surfaceId: PAGE, elementId: CONTROL }, {
            a: heardBy("control", "A"),
            y: heardBy("control", "Y"),
        }),
    ]);
    const stoppedByScript: string[] = [];
    /** Runs inside the global's script head, before it decides whether to stop the press. */
    const duringGlobal = { run: (_button: string): void => undefined };
    await mountCompiledScripts(
        { [scriptLayerKey("bp-global", SCRIPT_LAYER)]: { scriptRef: "scripts/bp-global.ts", url: "file:///global.mjs" } },
        undefined,
        async () => ({
            onGamepadButtonDown: (ctx: { stopPropagation(): void }, event: { button: string }) => {
                duringGlobal.run(event.button);
                if (event.button === "Y") {
                    stoppedByScript.push(event.button);
                    ctx.stopPropagation();
                }
            },
        }),
    );

    const core = createRecordingCore([]);
    const lines: string[] = [];
    const errors: string[] = [];
    core.debug.subscribeEvents(event => {
        if (event.type === "devtools.log") {
            lines.push(event.message);
        }
        if (event.type === "execution.error") {
            errors.push(event.message);
        }
    });
    const bundle: DevModeBundle = {
        bundleId: "bundle",
        revision: 1,
        timestamp: "2026-10-06T00:00:00.000Z",
        ui: {
            uidoc: uiDocument,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
            localBlueprints: blueprintDocument,
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    };
    const inputs: PageHostInputs = {
        core,
        capabilities: {
            onOpenSurface: async () => undefined,
            onPageBack: async () => undefined,
            onCloseOwnLayer: () => undefined,
            widgetRuntimeStore: new WidgetRuntimeStateStore(),
            localizationConfig: null,
            voiceConfig: null,
        } as unknown as GameHostCapabilities,
        bundle,
        startStory: async () => undefined,
        widgetPatches: { setByScope: () => undefined, byScopeRef: { current: {} as WidgetPatchesByScope } },
    };
    const hostAdapterBundleFor = cacheHostAdapterBundles((entry, surface) => buildPageHostAdapterBundle(inputs, entry, surface));
    const page: AppSurfaceLayerNavEntry = {
        key: `${PAGE}:1`,
        runtimeScopeId: `${PAGE}:1`,
        surfaceId: PAGE,
        direction: "forward",
        waitForExit: false,
        props: {},
        presentation: "appPage",
    };
    core.executionManager.openScope(page.runtimeScopeId);
    const pageHost = hostAdapterBundleFor(page, pageSurface)!;
    const owner: KeyboardOwner = { surface: pageSurface, host: pageHost };

    const pad = fakePad();
    setGamepadTrackerHost(pad.host);
    running.push(listenForGamepads({
        blueprintDocument,
        persistentVariables: {},
        core,
        globalHost: pageHost,
        vocabulary: {},
        readKeyboardOwner: () => owner,
        onError: error => errors.push(String(error)),
    }));
    // The first frame takes what is down as already down; nothing is.
    pad.tick();

    // The page as the game draws it, holding the keys - so the control's gamepad head is mounted
    // and listening the way a widget on the owning page is.
    const registry = new ElementRendererRegistry(
        ["nl.root", "nl.button"].map(type => ({
            type,
            render: ({ element, renderChildren }) => <>{renderChildren?.({ childrenIds: element.childrenIds })}</>,
        })),
    );
    render(
        <WidgetRuntimeStateProvider externalStore={new WidgetRuntimeStateStore()}>
            <WidgetRuntimeScopeProvider runtimeScopeId={page.runtimeScopeId}>
                <GameSurfaceRenderer
                    document={uiDocument}
                    surface={pageSurface}
                    rendererRegistry={registry}
                    scale={1}
                    hostAdapter={pageHost.hostAdapter}
                    keyboardInteractive
                    staticDocument
                />
            </WidgetRuntimeScopeProvider>
        </WidgetRuntimeStateProvider>,
    );

    /** One press of a button, down and up. Returns what answered, in order. */
    const press = async (button: Button) => {
        lines.length = 0;
        pad.press(button);
        await settle();
        return [...lines];
    };
    return { press, errors, stoppedByScript, duringGlobal };
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

beforeEach(() => {
    resetSharedInputHoldTracker();
    resetGamepadControls();
});

afterEach(() => {
    for (const stop of running.splice(0)) {
        stop();
    }
    cleanup();
    unmountCompiledScripts();
    resetSharedGamepadTracker();
    resetGamepadControls();
    document.body.innerHTML = "";
});

describe("a gamepad press goes the way a key goes", () => {
    it("reaches the global, then the page that owns the keys, then the control on it", async () => {
        const game = await runningGame();

        expect(await game.press("A")).toEqual(["global: A", "page: A", "control: A"]);
        expect(game.errors).toEqual([]);
    });

    it("stops at a global head that stops it, before the page and before the control", async () => {
        const game = await runningGame();

        const heard = await game.press("Y");

        expect(game.stoppedByScript).toEqual(["Y"]);
        expect(heard).toEqual(["global: Y"]);
        expect(game.errors).toEqual([]);
    });

    it("is not handed to a control that starts listening while the global's head runs", async () => {
        // A layer the global's head opens is drawn while that head runs; its controls must not also
        // hear the press that opened it.
        const game = await runningGame();
        const late: string[] = [];
        let stopLate: (() => void) | null = null;
        game.duringGlobal.run = () => {
            stopLate ??= listenAsGamepadControl(edge => {
                if (edge.type === "down") {
                    late.push(edge.button);
                }
            });
        };

        expect(await game.press("A")).toEqual(["global: A", "page: A", "control: A"]);
        expect(late).toEqual([]);

        // The next press finds it listening.
        await game.press("A");
        expect(late).toEqual(["A"]);
        stopLate?.();
    });

    it("skips a control that stopped listening while the global's head ran", async () => {
        // A page the press leaves takes its controls with it.
        const game = await runningGame();
        const heard: string[] = [];
        const stopListening = listenAsGamepadControl(edge => heard.push(`${edge.type} ${edge.button}`));
        game.duringGlobal.run = () => stopListening();

        await game.press("A");

        expect(heard).toEqual([]);
    });
});
