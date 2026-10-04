// @vitest-environment jsdom
/**
 * The game's global blueprint asks `Is Game Overlay` about the game, not about the active page.
 *
 * The global blueprint runs on the active page's host, and that host answered `Is Game Overlay` for
 * the page - how it was opened. During a game the active page is the one the game hid when it took
 * the screen, so a menu put up with `Show Layer` over the story left the answer false, and the two
 * library templates that gate a key on "the story is on screen" acted on the story behind the menu:
 * H hid the dialogue box under the Esc menu, A switched auto forward on under it. The global host now
 * answers with the rule the skip loop and the advance keys use - a page drawn over the stage, or a
 * modal layer - while a page's and a layer's own hosts keep answering for themselves.
 *
 * What runs is what a game runs, short of React around it: the layer stack, the composite's rule for
 * who owns the keyboard, the per-entry host builder and cache, the real host API and nodes, the
 * occlusion predicate, the key listener `GameApp` installs on `window`, and graphs built from the
 * template library through the path the editor inserts them by.
 *
 * Comments in English per project convention.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY,
    BLUEPRINT_NODE_TYPE_LAYER_SHOW,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { BLUEPRINT_LAYER_TEMPLATES } from "@/apps/workspace/modules/blueprint-lite/templates/blueprintLayerTemplates";
import { buildBlueprintLayerTemplate } from "@/apps/workspace/modules/blueprint-lite/templates/buildBlueprintLayerTemplate";
import type { BlueprintLayerShowRequest } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createBlueprintFnRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createRecordingCore } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { blueprintDocumentOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import type { AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";
import type { GameHostCapabilities } from "./gameHostApiOptions";
import { buildGlobalHostAdapterBundle } from "./globalHost";
import { buildPageHostAdapterBundle, cacheHostAdapterBundles, type PageHostInputs } from "./hostAdapterBundles";
import {
    listenForGameKeys,
    resolveKeyboardOwnerEntry,
    resolveKeyboardOwnerLane,
    type KeyboardOwner,
} from "./keyboardOwner";
import { resolveCompositeInput } from "./layers/compositeInput";
import { LayerStackController } from "./layers/LayerStackController";
import { isStageCovered } from "./layers/stageOcclusion";
import type { HostAdapterBundle } from "./types";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";

const TITLE = "title";
const MENU = "menu";
const SAVE = "save";
const HUD = "hud";
const QUICK = "quick";
const GLOBAL_BP = "bp-global";

function pageSurface(id: string): UISurface {
    return { id, name: id, host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: `${id}-root` };
}

const quickSurface = {
    id: QUICK,
    name: QUICK,
    kind: "stageSurface",
    mount: { kind: "stageSlot", slotId: "onStage" },
    designSize: { width: 640, height: 360 },
    rootElementId: `${QUICK}-root`,
    settings: { backgroundColor: "transparent" },
} as unknown as UISurface;

const uiDocument: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [pageSurface(TITLE), pageSurface(MENU), pageSurface(SAVE), pageSurface(HUD), quickSurface],
    elements: Object.fromEntries([TITLE, MENU, SAVE, HUD, QUICK].map(id => [`${id}-root`, {
        id: `${id}-root`,
        type: "nl.root",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 640, height: 360, visible: true },
    }])),
} as unknown as UIDocument;

const surfaceById = (id: string): UISurface => uiDocument.surfaces.find(surface => surface.id === id)!;

function blueprintOn(id: string, owner: BlueprintOwnerRef, layers: Record<string, BlueprintGraphIr>): Blueprint {
    return {
        id,
        name: id,
        owner,
        members: { variables: {}, fields: {}, functions: {} },
        bindings: {},
        graphs: {
            events: Object.fromEntries(Object.entries(layers).map(([layerId, graph]) => [layerId, { id: layerId, graph }])),
            functions: {},
        },
    } as unknown as Blueprint;
}

/** A library template's graph for `owner`, built the way the editor inserts one. */
function templateGraph(templateId: string, owner: BlueprintOwnerRef, choose?: (ir: BlueprintGraphIr) => void): BlueprintGraphIr {
    const template = BLUEPRINT_LAYER_TEMPLATES.find(item => item.id === templateId)!;
    let next = 0;
    const built = buildBlueprintLayerTemplate(template, { owner, facts: { locale: "zh" } }, () => `${templateId}-${(next += 1)}`);
    expect(built).not.toBeNull();
    choose?.(built!.ir);
    return built!.ir;
}

/** The author's pick on the Esc menu template: which page it shows. */
function showsMenu(ir: BlueprintGraphIr): void {
    const show = Object.values(ir.nodes ?? {}).find(node => node.type === BLUEPRINT_NODE_TYPE_LAYER_SHOW)!;
    show.params = { ...show.params, surfaceId: MENU };
}

/** F: calls a global Fn whose body logs what `Is Game Overlay` answers inside it. */
function fnReadsOverlay(): Record<string, BlueprintGraphIr> {
    const fnRef = createBlueprintFnRef(GLOBAL_BP, "fnHead");
    const node = (id: string, type: string, params?: Record<string, unknown>) => ({ id, type, ...(params ? { params } : {}) });
    const edge = (from: string, fromPort: string, to: string, toPort: string) => ({
        from: { nodeId: from, port: fromPort },
        to: { nodeId: to, port: toPort },
    });
    return {
        callsFn: {
            nodes: {
                head: node("head", BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN, { key: "F" }),
                call: node("call", BLUEPRINT_NODE_TYPE_FN_CALL, { [BLUEPRINT_NODE_PARAM_FN_REF]: fnRef }),
            },
            edges: [edge("head", "then", "call", "in")],
        } as unknown as BlueprintGraphIr,
        fn: {
            nodes: {
                fnHead: node("fnHead", BLUEPRINT_NODE_TYPE_FN_HEAD, { [BLUEPRINT_NODE_PARAM_FN_NAME]: "Report cover" }),
                overlay: node("overlay", BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY),
                branch: node("branch", BLUEPRINT_NODE_TYPE_FLOW_IF),
                coveredText: node("coveredText", BLUEPRINT_NODE_TYPE_LITERAL_STRING, { value: "fn: covered" }),
                clearText: node("clearText", BLUEPRINT_NODE_TYPE_LITERAL_STRING, { value: "fn: clear" }),
                covered: node("covered", BLUEPRINT_NODE_TYPE_LOG),
                clear: node("clear", BLUEPRINT_NODE_TYPE_LOG),
            },
            edges: [
                edge("fnHead", "then", "branch", "in"),
                edge("overlay", "isGameOverlay", "branch", "condition"),
                edge("branch", "true", "covered", "in"),
                edge("branch", "false", "clear", "in"),
                edge("coveredText", "value", "covered", "value"),
                edge("clearText", "value", "clear", "value"),
            ],
        } as unknown as BlueprintGraphIr,
    };
}

function navEntry(surfaceId: string, presentation: AppSurfaceLayerNavEntry["presentation"]): AppSurfaceLayerNavEntry {
    return {
        key: `${surfaceId}:1`,
        runtimeScopeId: `${surfaceId}:1`,
        surfaceId,
        direction: "forward",
        waitForExit: false,
        props: {},
        presentation,
    };
}

const running: Array<() => void> = [];

/** Let every graph a key started run to the end. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 3; turn++) {
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

/**
 * A game wired as `GameApp` wires one: the title page the game hid when it took the screen (or, with
 * `inGame: false`, the page on screen), the quick menu on the stage with the Esc menu template, the
 * global blueprint with the hide-dialogue key template, and the key listener on `window`.
 */
function runningGame(options: { inGame?: boolean; activePresentation?: AppSurfaceLayerNavEntry["presentation"] } = {}) {
    let inGame = options.inGame ?? true;
    const title = navEntry(TITLE, options.activePresentation ?? "appPage");
    const pageEntries: AppSurfaceLayerNavEntry[] = [title];
    const layerStack = new LayerStackController();
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
    let dialogToggles = 0;

    const blueprintDocument = blueprintDocumentOf([
        blueprintOn(GLOBAL_BP, { kind: "globalMain" }, {
            hideDialogKey: templateGraph("hideDialogKey", { kind: "globalMain" }),
            ...fnReadsOverlay(),
        }),
        blueprintOn("bp-quick", { kind: "surfaceMain", surfaceId: QUICK }, {
            escapeMenu: templateGraph("escapeMenu", { kind: "surfaceMain", surfaceId: QUICK }, showsMenu),
        }),
        blueprintOn("bp-menu", { kind: "surfaceMain", surfaceId: MENU }, {
            escapeBack: templateGraph("escapeBack", { kind: "surfaceMain", surfaceId: MENU }),
        }),
    ]);
    const bundle: DevModeBundle = {
        bundleId: "bundle",
        revision: 1,
        timestamp: "2026-10-03T00:00:00.000Z",
        ui: {
            uidoc: uiDocument,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
            localBlueprints: blueprintDocument,
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    };
    const drawableSurfaceIds = new Set(uiDocument.surfaces.map(surface => surface.id));
    /** `GameApp.isStageCoveredNow`: the same predicate, over the same live stores. */
    const stageCovered = () => isStageCovered({
        pageEntries,
        pagesHiddenForGame: inGame,
        gameHiddenKeys: new Set(inGame ? [title.key] : []),
        layers: layerStack.getSnapshot().layers,
        drawableSurfaceIds,
    });
    const isStoryOnScreen = () => inGame && !stageCovered();

    const inputs: PageHostInputs = {
        core,
        capabilities: {
            onOpenSurface: async () => undefined,
            // `GameApp.goBack`: a dismissible layer on top closes first.
            onPageBack: async () => {
                layerStack.dismissTop();
            },
            // `GameApp.showLayer`: stamped as a game overlay while a game holds the screen.
            onShowLayer: (request: BlueprintLayerShowRequest) => {
                const key = layerStack.show({ ...request, presentation: inGame ? "gameOverlay" : "appPage" });
                core.executionManager.openScope(key);
                return key;
            },
            onCloseOwnLayer: (runtimeScopeId: string, result: unknown) => layerStack.closeWithResult(runtimeScopeId, result),
            onIsInGame: () => inGame,
            onToggleDialogDisplay: () => {
                dialogToggles += 1;
            },
            widgetRuntimeStore: new WidgetRuntimeStateStore(),
            localizationConfig: null,
            voiceConfig: null,
        } as unknown as GameHostCapabilities,
        bundle,
        startStory: async () => undefined,
        widgetPatches: { setByScope: () => undefined, byScopeRef: { current: {} as WidgetPatchesByScope } },
    };
    const hostFor = cacheHostAdapterBundles((entry, surface) => buildPageHostAdapterBundle(inputs, entry, surface));
    const quickEntry = navEntry(QUICK, "gameOverlay");
    for (const scope of [title.runtimeScopeId, quickEntry.runtimeScopeId]) {
        core.executionManager.openScope(scope);
    }
    const quickHost = hostFor(quickEntry, quickSurface)!;

    /** The active page's host - what the global blueprint used to run on, unchanged. */
    const activePage = () => pageEntries[pageEntries.length - 1]!;
    const pageHost = (): HostAdapterBundle => hostFor(activePage(), surfaceById(activePage().surfaceId))!;
    const globalHost = (): HostAdapterBundle => buildGlobalHostAdapterBundle(pageHost(), {
        isInGame: () => inGame,
        isStageCovered: stageCovered,
    });
    const answer = (host: HostAdapterBundle) => host.hostAdapter.blueprintRuntime!.hostApi!.game.isGameOverlay();

    /** `GameApp`'s keyboard owner: a ready entry - the page, a modal layer - or the stage while the story is on screen. */
    const readKeyboardOwner = (): KeyboardOwner | null => {
        const layers = layerStack.getState();
        const page = activePage();
        const composite = resolveCompositeInput({ pageEntries, activePageKey: page.key, layers });
        const owner = resolveKeyboardOwnerEntry<AppSurfaceLayerNavEntry>({
            keyboardOwnerKey: composite.keyboardOwnerKey,
            // The page a game hid is on the stack and not drawn, so it is never ready.
            page: { entry: page, surface: surfaceById(page.surfaceId), ready: !(inGame && page === title) },
            layers: layers.map(layer => ({ entry: layer, surface: surfaceById(layer.surfaceId), ready: true })),
        });
        const lane = resolveKeyboardOwnerLane({ entry: owner, isStoryOnScreen });
        if (lane?.kind === "entry") {
            return { surface: lane.entry.surface, host: hostFor(lane.entry.entry, lane.entry.surface)! };
        }
        if (lane?.kind === "stage") {
            return { stage: [{ surface: quickSurface, hostAdapter: quickHost.hostAdapter, runtimeScopeId: quickHost.runtimeScopeId }] };
        }
        return null;
    };

    const listen = (host: () => HostAdapterBundle) => {
        const stop = listenForGameKeys(window, {
            blueprintDocument,
            persistentVariables: {},
            vocabulary: {},
            core,
            globalHost: host(),
            readKeyboardOwner,
            onError: error => errors.push(String(error)),
        });
        running.push(stop);
    };

    /** One real key on the window, pressed and released. */
    const press = async (key: string) => {
        const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
        window.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true }));
        await settle();
        window.dispatchEvent(new KeyboardEvent("keyup", { key, code, bubbles: true, cancelable: true }));
        await settle();
    };

    return {
        layerStack,
        pageEntries,
        title,
        hostFor,
        pageHost,
        globalHost,
        answer,
        listen,
        press,
        lines,
        errors,
        toggles: () => dialogToggles,
        setInGame: (value: boolean) => {
            inGame = value;
        },
        showLayer: (surfaceId: string, modal: boolean) => {
            const key = layerStack.show({ surfaceId, modal, presentation: inGame ? "gameOverlay" : "appPage" });
            core.executionManager.openScope(key);
            return key;
        },
    };
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

afterEach(() => {
    for (const stop of running.splice(0)) {
        stop();
    }
});

describe("the global blueprint's Is Game Overlay during a game", () => {
    it("is false while the story is on screen", () => {
        const game = runningGame();

        expect(game.answer(game.globalHost())).toBe(false);
    });

    it("is true while a modal layer is drawn over the story", () => {
        const game = runningGame();
        game.showLayer(MENU, true);

        expect(game.answer(game.globalHost())).toBe(true);
    });

    it("is false under a layer that is not modal", () => {
        // A HUD or a toast declares nothing about what is under it; the story is as live as it was.
        const game = runningGame();
        game.showLayer(HUD, false);

        expect(game.answer(game.globalHost())).toBe(false);
    });

    it("is true while a page is drawn over the story", () => {
        const game = runningGame();
        game.pageEntries.push(navEntry(SAVE, "gameOverlay"));

        expect(game.answer(game.globalHost())).toBe(true);
    });

    it("reads the screen when it is asked, not when the host was built", () => {
        // A key pressed the instant a layer opens or closes must see the screen as it is then.
        const game = runningGame();
        const host = game.globalHost();

        const key = game.showLayer(MENU, true);
        expect(game.answer(host)).toBe(true);
        game.layerStack.hide(key);
        expect(game.answer(host)).toBe(false);
    });
});

describe("the global blueprint's Is Game Overlay outside a game", () => {
    it("is the active page's answer, as it was", () => {
        const game = runningGame({ inGame: false });
        game.showLayer(MENU, true);

        expect(game.answer(game.globalHost())).toBe(false);
        expect(game.answer(game.globalHost())).toBe(game.answer(game.pageHost()));
    });

    it("keeps a page's game overlay stamp once the session is gone", () => {
        // A pause menu still leaving after Quit Game answers true for itself, and the global with it.
        const game = runningGame({ inGame: false, activePresentation: "gameOverlay" });

        expect(game.answer(game.globalHost())).toBe(true);
    });
});

describe("a page's and a layer's own Is Game Overlay", () => {
    it("still answers for the page, under a modal layer", () => {
        const game = runningGame();
        game.showLayer(MENU, true);

        expect(game.answer(game.pageHost())).toBe(false);
    });

    it("still answers for the layer, which a game shows as a game overlay", () => {
        const game = runningGame();
        game.showLayer(MENU, true);
        const [layer] = game.layerStack.getState();

        expect(game.answer(game.hostFor(layer!, surfaceById(MENU))!)).toBe(true);
    });
});

describe("the hide-dialogue key template on the global blueprint", () => {
    it("leaves the dialogue alone while the Esc menu is up, and works again once it closes", async () => {
        const game = runningGame();
        game.listen(game.globalHost);

        await game.press("h");
        expect(game.toggles()).toBe(1);

        await game.press("Escape");
        expect(game.layerStack.getState().map(layer => layer.surfaceId)).toEqual([MENU]);
        await game.press("h");
        expect(game.toggles()).toBe(1);

        await game.press("Escape");
        expect(game.layerStack.getState()).toEqual([]);
        await game.press("h");
        expect(game.toggles()).toBe(2);
        expect(game.errors).toEqual([]);
    });

    it("still works under a layer that is not modal", async () => {
        const game = runningGame();
        game.listen(game.globalHost);
        game.showLayer(HUD, false);

        await game.press("h");
        expect(game.toggles()).toBe(1);
        expect(game.errors).toEqual([]);
    });

    it("does nothing outside a game", async () => {
        const game = runningGame({ inGame: false });
        game.listen(game.globalHost);

        await game.press("h");
        expect(game.toggles()).toBe(0);
    });
});

describe("a Fn the global blueprint calls", () => {
    it("reads the global answer, as the graph that called it does", async () => {
        const game = runningGame();
        game.listen(game.globalHost);

        await game.press("f");
        game.showLayer(MENU, true);
        await game.press("f");

        expect(game.lines).toEqual(["fn: clear", "fn: covered"]);
        expect(game.errors).toEqual([]);
    });
});
