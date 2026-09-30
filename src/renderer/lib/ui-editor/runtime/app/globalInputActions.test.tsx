// @vitest-environment jsdom
/**
 * An `On Action` on the game's global blueprint fires wherever the player is.
 *
 * The head was offered on the global blueprint and declared in its lifecycle table, and nothing
 * anywhere dispatched an action to it: an author could place `On Action quickSave` there, press the
 * key on every screen of the game, and never see it run. What an author means by putting it there is
 * "this gesture means this wherever the player is", so that is what these pin - for a key, on a page
 * and under a modal layer that holds the keyboard, and for a click on whatever lane it lands on.
 *
 * Two rules come with it, both the ones the global key heads already had. The global answers first
 * and the thing on screen answers after it, so a graph there cannot race the page's. And both run:
 * the global answering an action does not keep it from a page that answers it too, unless a global
 * handler stops the input - which is the one stop a global key head has.
 *
 * What runs is what a game runs, short of React around the whole of it: the layer stack, the
 * composite's ownership rule, the per-entry host builder and cache, the real host API and nodes, the
 * key listener `GameApp` installs on `window`, and for the pointer half the real surface renderer with
 * the function `GameApp` hands its lanes. What is asserted is which graphs answered, and in what order.
 *
 * Comments in English per project convention.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { SyntheticEvent } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import type { UISurfaceActionEnablement } from "@shared/types/ui-editor/inputAction";
import { scriptLayerKey } from "@shared/blueprint/blueprintLayers";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { mountCompiledScripts, unmountCompiledScripts } from "@/lib/ui-editor/blueprint-runtime/script/scriptRuntime";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { WidgetRuntimeScopeProvider, WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    GlobalInputActionContext,
    type GlobalInputActionAnswerer,
} from "@/lib/ui-editor/runtime/input/globalInputActionContext";
import { resetSharedInputHoldTracker } from "@/lib/ui-editor/runtime/input/inputHoldState";
import { resetSharedTouchGestureTracker } from "@/lib/ui-editor/runtime/input/touchGesture";
import { wheelGestureGate } from "@/lib/ui-editor/runtime/input/wheelGesture";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import { createRecordingCore } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { blueprintDocumentOf, graphOf, type GraphNode } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import type { AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";
import type { GameHostCapabilities } from "./gameHostApiOptions";
import { answerGlobalInputActions, type GlobalBlueprintDispatch } from "./globalInputActions";
import { offerUnclaimedPointerInput, RUNTIME_PLUGIN_OVERLAY_ATTR } from "./globalPointerInput";
import { buildPageHostAdapterBundle, cacheHostAdapterBundles, type PageHostInputs } from "./hostAdapterBundles";
import { listenForGameKeys, resolveKeyboardOwnerEntry, type KeyboardOwner } from "./keyboardOwner";
import { resolveCompositeInput } from "./layers/compositeInput";
import { LayerStackController } from "./layers/LayerStackController";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";

const PAGE = "page";
const DIALOG = "dialog";
/** The action under test: a quick save, bound to a key and to a right click. */
const QUICK_SAVE = "quickSave";
/** Another action, bound to a key nobody presses here, so "every action" is not "the only action". */
const OTHER = "other";
const SCRIPT_LAYER = "layer-script";

function surfaceOf(id: string, actions: UISurfaceActionEnablement[]): UISurface {
    return {
        id,
        name: id,
        host: "app",
        kind: "appSurface",
        designSize: { width: 640, height: 360 },
        rootElementId: `${id}-root`,
        actions,
    };
}

function rootOf(surfaceId: string, childrenIds: string[] = []): UIElement {
    return {
        id: `${surfaceId}-root`,
        type: "nl.root",
        parentId: null,
        childrenIds,
        layout: { x: 0, y: 0, width: 640, height: 360, visible: true },
    };
}

function documentOf(options: { pageAnswers: boolean; dialogAnswers: boolean }): UIDocument {
    const answers = (yes: boolean): UISurfaceActionEnablement[] => (yes ? [{ actionId: QUICK_SAVE }] : []);
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        actions: {
            [QUICK_SAVE]: {
                id: QUICK_SAVE,
                name: "Quick save",
                bindings: [{ kind: "key", key: "F5" }, { kind: "pointer", gesture: "rightClick" }],
            },
            [OTHER]: { id: OTHER, name: "Other", bindings: [{ kind: "key", key: "F9" }] },
        },
        surfaces: [surfaceOf(PAGE, answers(options.pageAnswers)), surfaceOf(DIALOG, answers(options.dialogAnswers))],
        elements: {
            [`${PAGE}-root`]: rootOf(PAGE, ["page-button"]),
            "page-button": {
                id: "page-button",
                type: "nl.button",
                parentId: `${PAGE}-root`,
                childrenIds: [],
                layout: { x: 20, y: 20, width: 120, height: 40, visible: true },
            },
            [`${DIALOG}-root`]: rootOf(DIALOG),
        },
    };
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

/** A head that logs a line when it runs. */
function logs(head: GraphNode, line: string) {
    return graphOf({
        nodes: {
            head,
            say: { type: "blueprint.data.stringLiteral", params: { value: line } },
            log: { type: BLUEPRINT_NODE_TYPE_LOG },
        },
        exec: ["head", "log"],
        data: [["say", "value", "log", "value"]],
    });
}

/**
 * A head that waits before it logs.
 *
 * The global's graph takes a while on purpose: a page whose graph started alongside it instead of
 * after it would log first, so the order of the lines is the order the two were run in, not the
 * order two instant graphs happened to finish.
 */
function waitsThenLogs(head: GraphNode, line: string) {
    return {
        nodes: {
            head: { id: "head", ...head },
            wait: { id: "wait", type: "blueprint.flow.delay", params: { duration: 0.05 } },
            say: { id: "say", type: "blueprint.data.stringLiteral", params: { value: line } },
            log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG },
        },
        edges: [
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "wait", port: "in" } },
            { from: { nodeId: "wait", port: "completed" }, to: { nodeId: "log", port: "in" } },
            { from: { nodeId: "say", port: "value" }, to: { nodeId: "log", port: "value" } },
        ],
    } as unknown as ReturnType<typeof graphOf>;
}

const onQuickSave: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, params: { actionId: QUICK_SAVE } };
const onOther: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, params: { actionId: OTHER } };
const f5Down: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN, params: { key: "F5" } };

const running: Array<() => void> = [];

/** Let every graph an input started run to the end, the global's wait included. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 3; turn++) {
        await new Promise(resolve => setTimeout(resolve, 60));
    }
}

/**
 * A game with a page open, optionally a layer over it, and the key listener on `window` - wired as
 * `GameApp` wires one.
 */
function runningGame(options: {
    pageAnswers?: boolean;
    dialog?: { modal: boolean; answers?: boolean };
    /** A global script whose `onAction` stops the input, as a global key head's can. */
    globalScriptStops?: boolean;
}) {
    const document = documentOf({ pageAnswers: options.pageAnswers ?? false, dialogAnswers: options.dialog?.answers ?? false });
    const pageSurface = document.surfaces[0]!;
    const dialogSurface = document.surfaces[1]!;
    const globalBlueprint = blueprintOn("bp-global", { kind: "globalMain" }, {
        keyHead: logs(f5Down, "global: key down"),
        quickSave: waitsThenLogs(onQuickSave, "global: quickSave"),
        other: logs(onOther, "global: other"),
        ...(options.globalScriptStops ? { [SCRIPT_LAYER]: "script" as const } : {}),
    });
    const blueprintDocument = blueprintDocumentOf([
        globalBlueprint,
        blueprintOn("bp-page", { kind: "surfaceMain", surfaceId: PAGE }, { quickSave: logs(onQuickSave, "page: quickSave") }),
        blueprintOn("bp-dialog", { kind: "surfaceMain", surfaceId: DIALOG }, { quickSave: logs(onQuickSave, "dialog: quickSave") }),
    ]);
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
        timestamp: "2026-09-21T00:00:00.000Z",
        ui: {
            uidoc: document,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
            localBlueprints: blueprintDocument,
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    };
    const layerStack = new LayerStackController();
    const inputs: PageHostInputs = {
        core,
        capabilities: {
            onOpenSurface: async () => undefined,
            onPageBack: async () => undefined,
            onCloseOwnLayer: (runtimeScopeId: string, result: unknown) => layerStack.closeWithResult(runtimeScopeId, result),
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
    if (options.dialog) {
        const key = layerStack.show({ surfaceId: DIALOG, modal: options.dialog.modal, ownerScopeId: page.runtimeScopeId });
        core.executionManager.openScope(key);
    }

    const readKeyboardOwner = (): KeyboardOwner | null => {
        const layers = layerStack.getState();
        const composite = resolveCompositeInput({ pageEntries: [page], activePageKey: page.key, layers });
        const owner = resolveKeyboardOwnerEntry<AppSurfaceLayerNavEntry>({
            keyboardOwnerKey: composite.keyboardOwnerKey,
            page: { entry: page, surface: pageSurface, ready: true },
            layers: layers.map(layer => ({ entry: layer, surface: dialogSurface, ready: true })),
        });
        const host = owner ? hostAdapterBundleFor(owner.entry, owner.surface) : null;
        return owner && host ? { surface: owner.surface, host } : null;
    };

    const pageHost = hostAdapterBundleFor(page, pageSurface)!;
    const globalDispatch: GlobalBlueprintDispatch = {
        blueprintDocument,
        persistentVariables: {},
        core,
        globalHost: pageHost,
    };
    const stop = listenForGameKeys(window, {
        ...globalDispatch,
        vocabulary: document.actions,
        readKeyboardOwner,
        onError: error => errors.push(String(error)),
    });
    running.push(stop);

    /** One real key on the window, pressed and released. Returns what answered, in order. */
    const press = async (key: string, target: EventTarget = window) => {
        lines.length = 0;
        const init = { key, code: key, bubbles: true, cancelable: true };
        target.dispatchEvent(new KeyboardEvent("keydown", init));
        await settle();
        target.dispatchEvent(new KeyboardEvent("keyup", init));
        await settle();
        return [...lines];
    };

    /**
     * The page drawn by the real surface renderer on its own host, inside a game root wired as
     * `GameApp` wires its own: the function it hands every lane it draws, and the same function
     * offered whatever bubbles up to the root - beside the page, an empty spot of the stage, and a
     * plugin's overlay. Returns a right click on one of them and what answered, in order.
     */
    const drawPage = () => {
        const registry = new ElementRendererRegistry(
            ["nl.root", "nl.button"].map(type => ({
                type,
                render: ({ element, renderChildren }) => <>{renderChildren?.({ childrenIds: element.childrenIds })}</>,
            })),
        );
        const answer: GlobalInputActionAnswerer = (payloads, eventControl) =>
            answerGlobalInputActions(globalDispatch, payloads, eventControl);
        const offer = (event: SyntheticEvent<HTMLDivElement>) => {
            offerUnclaimedPointerInput({ event: event.nativeEvent, root: event.currentTarget, document, scale: 1, answer });
        };
        const view = render(
            <GlobalInputActionContext.Provider value={answer}>
                <WidgetRuntimeStateProvider externalStore={new WidgetRuntimeStateStore()}>
                    <WidgetRuntimeScopeProvider runtimeScopeId={page.runtimeScopeId}>
                        <div data-testid="game-root" onContextMenu={offer}>
                            <div data-testid="stage" />
                            <div {...{ [RUNTIME_PLUGIN_OVERLAY_ATTR]: "" }}>
                                <button type="button" data-testid="plugin-button">plugin</button>
                            </div>
                            <GameSurfaceRenderer
                                document={document}
                                surface={pageSurface}
                                rendererRegistry={registry}
                                scale={1}
                                hostAdapter={pageHost.hostAdapter}
                                staticDocument
                            />
                        </div>
                    </WidgetRuntimeScopeProvider>
                </WidgetRuntimeStateProvider>
            </GlobalInputActionContext.Provider>,
        );
        const node = (id: string) =>
            view.container.querySelector(`[data-ui-element-id="${id}"]`) ?? view.getByTestId(id);
        const rightClick = async (id: string) => {
            lines.length = 0;
            fireEvent.contextMenu(node(id));
            await settle();
            return [...lines];
        };
        return { rightClick };
    };

    return { press, drawPage, errors };
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

beforeEach(() => {
    wheelGestureGate.reset();
    resetSharedTouchGestureTracker();
    resetSharedInputHoldTracker();
});

afterEach(() => {
    for (const stop of running.splice(0)) {
        stop();
    }
    cleanup();
    unmountCompiledScripts();
    document.body.innerHTML = "";
});

describe("the global blueprint hears an action's key wherever the player is", () => {
    it("fires on a page that does not answer the action itself", async () => {
        const game = runningGame({});

        expect(await game.press("F5")).toEqual(["global: key down", "global: quickSave"]);
        expect(game.errors).toEqual([]);
    });

    it("fires only the actions the key is bound to", async () => {
        const game = runningGame({});

        expect(await game.press("F9")).toEqual(["global: other"]);
        expect(await game.press("F1")).toEqual([]);
    });

    it("fires while a modal layer holds the keyboard, and the layer answers after it", async () => {
        const game = runningGame({ pageAnswers: true, dialog: { modal: true, answers: true } });

        expect(await game.press("F5")).toEqual(["global: key down", "global: quickSave", "dialog: quickSave"]);
        expect(game.errors).toEqual([]);
    });

    it("fires under a modal layer that answers nothing", async () => {
        const game = runningGame({ pageAnswers: true, dialog: { modal: true } });

        expect(await game.press("F5")).toEqual(["global: key down", "global: quickSave"]);
    });

    it("runs to the end before the page that answers the same action starts", async () => {
        // The global's graph waits before it logs; a page started alongside it would log first.
        const game = runningGame({ pageAnswers: true });

        expect(await game.press("F5")).toEqual(["global: key down", "global: quickSave", "page: quickSave"]);
    });

    it("keeps the action from the page when a global handler stops the input", async () => {
        const game = runningGame({ pageAnswers: true, globalScriptStops: true });
        const heardByScript: string[] = [];
        await mountCompiledScripts(
            { [scriptLayerKey("bp-global", SCRIPT_LAYER)]: { scriptRef: "scripts/bp-global.ts", url: "file:///global.mjs" } },
            undefined,
            async () => ({
                onAction: (ctx: { stopPropagation(): void }, event: { actionId: string }) => {
                    heardByScript.push(event.actionId);
                    ctx.stopPropagation();
                },
            }),
        );

        const heard = await game.press("F5");

        expect(heardByScript).toEqual([QUICK_SAVE]);
        expect(heard).not.toContain("page: quickSave");
        expect(game.errors).toEqual([]);
    });

    it("does not fire while a text field has the keys", async () => {
        const game = runningGame({ pageAnswers: true });
        const field = document.createElement("input");
        field.type = "text";
        document.body.appendChild(field);

        expect(await game.press("F5", field)).toEqual([]);
    });
});

describe("the global blueprint hears an action's pointer gesture on the lane it lands on", () => {
    it("fires for a right click on a page that does not answer the action itself", async () => {
        const game = runningGame({});
        const page = game.drawPage();

        expect(await page.rightClick(`${PAGE}-root`)).toEqual(["global: quickSave"]);
        expect(game.errors).toEqual([]);
    });

    it("runs to the end before the page that answers the same action starts", async () => {
        const game = runningGame({ pageAnswers: true });
        const page = game.drawPage();

        expect(await page.rightClick(`${PAGE}-root`)).toEqual(["global: quickSave", "page: quickSave"]);
    });

    it("stands down over a control, as the page's own action does", async () => {
        const game = runningGame({ pageAnswers: true });
        const page = game.drawPage();

        expect(await page.rightClick("page-button")).toEqual([]);
    });

    it("fires for a right click that landed on no lane at all", async () => {
        // An empty spot of a page lets the click through to the stage, and before a story starts
        // there is nothing on the stage to take it. The game received it, and the global is the game's.
        const game = runningGame({ pageAnswers: true });
        const page = game.drawPage();

        expect(await page.rightClick("stage")).toEqual(["global: quickSave"]);
    });

    it("hears a right click the page took once, not again at the game's root", async () => {
        const game = runningGame({});
        const page = game.drawPage();

        expect(await page.rightClick(`${PAGE}-root`)).toEqual(["global: quickSave"]);
    });

    it("leaves a plugin's overlay alone, as it leaves a page's control", async () => {
        const game = runningGame({});
        const page = game.drawPage();

        expect(await page.rightClick("plugin-button")).toEqual([]);
    });
});
