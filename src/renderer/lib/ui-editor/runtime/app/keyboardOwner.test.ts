// @vitest-environment jsdom
/**
 * The entry that owns the keyboard is the one that hears the keys - a modal layer as much as a page.
 *
 * `resolveCompositeInput` has always said a modal layer owns the keyboard, and a layer's own element
 * heads took their keys on that answer. The surface half did not: `GameApp` sent a key's surface
 * `On Key Down` / `On Key Up` heads and the input actions it raises to the active page or to nobody,
 * so while a modal layer was up, the one thing on screen that owned the keys was the one thing that
 * could not hear them. "Escape closes the confirmation" could not be written with an action.
 *
 * What runs here is what a game runs, short of React: the layer stack `Show Layer` and `Close This
 * Layer` drive, the composite's ownership rule, the owner lookup `GameApp` makes each render, the
 * per-entry host builder and cache its layers share, the real host API and nodes, and the listener
 * `GameApp` installs - on `window`, for real key events. What is asserted is which graphs answered.
 *
 * Comments in English per project convention.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import type { UISurfaceActionEnablement } from "@shared/types/ui-editor/inputAction";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createRecordingCore } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { blueprintDocumentOf, graphOf, type GraphNode } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import type { AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";
import type { GameHostCapabilities } from "./gameHostApiOptions";
import { buildPageHostAdapterBundle, cacheHostAdapterBundles, type PageHostInputs } from "./hostAdapterBundles";
import { listenForGameKeys, resolveKeyboardOwnerEntry, type KeyboardOwner } from "./keyboardOwner";
import { resolveCompositeInput } from "./layers/compositeInput";
import { LayerStackController } from "./layers/LayerStackController";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";

const PAGE = "page";
const DIALOG = "dialog";
/** The one action both answer, bound to Escape: a "cancel", the shape of every close in the starter project. */
const CANCEL = "cancel";

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

function rootOf(surfaceId: string): UIElement {
    return {
        id: `${surfaceId}-root`,
        type: "nl.root",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 640, height: 360, visible: true },
    };
}

function documentOf(dialogActions: UISurfaceActionEnablement[]): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        actions: { [CANCEL]: { id: CANCEL, name: "Cancel", bindings: [{ kind: "key", key: "Escape" }] } },
        surfaces: [surfaceOf(PAGE, [{ actionId: CANCEL }]), surfaceOf(DIALOG, dialogActions)],
        elements: { [`${PAGE}-root`]: rootOf(PAGE), [`${DIALOG}-root`]: rootOf(DIALOG) },
    };
}

function blueprintOn(id: string, owner: BlueprintOwnerRef, layers: Record<string, ReturnType<typeof graphOf>>): Blueprint {
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

/** A head that logs a line when it runs, and then, optionally, does something else. */
function logs(head: GraphNode, line: string, then?: GraphNode) {
    return graphOf({
        nodes: {
            head,
            say: { type: "blueprint.data.stringLiteral", params: { value: line } },
            log: { type: BLUEPRINT_NODE_TYPE_LOG },
            ...(then ? { then } : {}),
        },
        exec: then ? ["head", "log", "then"] : ["head", "log"],
        data: [["say", "value", "log", "value"]],
    });
}

const escapeDown: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN, params: { key: "Escape" } };
const escapeUp: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP, params: { key: "Escape" } };
const onCancel: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, params: { actionId: CANCEL } };

/** Every surface-level way a page hears Escape, each saying who heard it. */
function hearsEverything(surfaceId: string, onCancelThen?: GraphNode): Blueprint {
    return blueprintOn(`bp-${surfaceId}`, { kind: "surfaceMain", surfaceId }, {
        down: logs(escapeDown, `${surfaceId}: key down`),
        up: logs(escapeUp, `${surfaceId}: key up`),
        cancel: logs(onCancel, `${surfaceId}: cancel`, onCancelThen),
    });
}

/** The game's own key head, which hears every key whoever owns the keyboard. */
const globalHearsEscape = blueprintOn("bp-global", { kind: "globalMain" }, {
    down: logs(escapeDown, "global: key down"),
});

const running: Array<() => void> = [];

/**
 * A game with a page open and a layer stack over it, wired as `GameApp` wires one: the per-entry
 * host lookup its layers and its own dispatches share, the composite resolved from the stack as it
 * stands at each press, and the key listener on `window`.
 */
function runningGame(options: {
    dialog?: { modal: boolean; actions?: UISurfaceActionEnablement[]; closesOnCancel?: boolean };
    /** Whether the layer has painted yet; a layer still arriving does not take keys. */
    dialogReady?: boolean;
}) {
    const dialogActions = options.dialog?.actions ?? [{ actionId: CANCEL }];
    const document = documentOf(dialogActions);
    const pageSurface = document.surfaces[0]!;
    const dialogSurface = document.surfaces[1]!;
    const blueprintDocument = blueprintDocumentOf([
        globalHearsEscape,
        hearsEverything(PAGE),
        hearsEverything(DIALOG, options.dialog?.closesOnCancel ? { type: "blueprint.layer.closeSelf" } : undefined),
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
            // `Close This Layer`, as `GameApp` answers it: the layer's key is its scope.
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
    const surfaceOfEntry = (entry: { surfaceId: string }) => (entry.surfaceId === DIALOG ? dialogSurface : pageSurface);

    if (options.dialog) {
        const key = layerStack.show({ surfaceId: DIALOG, modal: options.dialog.modal, ownerScopeId: page.runtimeScopeId });
        core.executionManager.openScope(key);
    }

    /** What `GameApp` works out on every render: the composite, then the owner and its host. */
    const readKeyboardOwner = (): KeyboardOwner | null => {
        const layers = layerStack.getState();
        const composite = resolveCompositeInput({
            pageEntries: [page],
            activePageKey: page.key,
            layers,
        });
        const owner = resolveKeyboardOwnerEntry<AppSurfaceLayerNavEntry>({
            keyboardOwnerKey: composite.keyboardOwnerKey,
            page: { entry: page, surface: pageSurface, ready: true },
            layers: layers.map(layer => ({ entry: layer, surface: surfaceOfEntry(layer), ready: options.dialogReady ?? true })),
        });
        const host = owner ? hostAdapterBundleFor(owner.entry, owner.surface) : null;
        return owner && host ? { surface: owner.surface, host } : null;
    };

    const stop = listenForGameKeys(window, {
        blueprintDocument,
        persistentVariables: {},
        vocabulary: document.actions,
        core,
        globalHost: hostAdapterBundleFor(page, pageSurface)!,
        readKeyboardOwner,
        onError: error => errors.push(String(error)),
    });
    running.push(stop);

    /** Let every graph a key started run to the end: they are async all the way down. */
    const settle = async () => {
        for (let turn = 0; turn < 10; turn++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    };

    /**
     * One real Escape on the window, pressed and then released - with the graphs the press started
     * finished in between, as they are by the time a finger comes off a key. Returns who heard it.
     */
    const pressEscape = async () => {
        lines.length = 0;
        const init = { key: "Escape", code: "Escape", bubbles: true, cancelable: true };
        window.dispatchEvent(new KeyboardEvent("keydown", init));
        await settle();
        window.dispatchEvent(new KeyboardEvent("keyup", init));
        await settle();
        return [...lines].sort();
    };

    return { pressEscape, layerStack, errors };
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

afterEach(() => {
    for (const stop of running.splice(0)) {
        stop();
    }
});

describe("the keys go to whichever entry owns the keyboard", () => {
    it("a page with nothing over it hears Escape through its action and its key heads", async () => {
        const game = runningGame({});

        expect(await game.pressEscape()).toEqual([
            "global: key down",
            "page: cancel",
            "page: key down",
            "page: key up",
        ]);
        expect(game.errors).toEqual([]);
    });

    it("a modal layer hears Escape through its action and its key heads, and the page under it does not", async () => {
        const game = runningGame({ dialog: { modal: true } });

        expect(await game.pressEscape()).toEqual([
            "dialog: cancel",
            "dialog: key down",
            "dialog: key up",
            "global: key down",
        ]);
        expect(game.errors).toEqual([]);
    });

    it("the page hears nothing under a modal layer, even an action the layer lets bubble", async () => {
        // A key has no lanes under it: "keep bubbling" hands a pointer to what is painted behind,
        // and the page under a modal is inert to a pointer as well. The same is true of a page's
        // own action set to bubble - its key goes nowhere further - so the rule is one rule.
        const game = runningGame({ dialog: { modal: true, actions: [{ actionId: CANCEL, consume: false }] } });

        const heard = await game.pressEscape();

        expect(heard).toContain("dialog: cancel");
        expect(heard.filter(line => line.startsWith("page:"))).toEqual([]);
    });

    it("one Escape that closes the layer is not answered by the page too, and the next one is", async () => {
        const game = runningGame({ dialog: { modal: true, closesOnCancel: true } });

        expect(await game.pressEscape()).toEqual([
            "dialog: cancel",
            "dialog: key down",
            "global: key down",
            // The release is the page's. By the time the key comes up the dialog has gone and the
            // page owns the keyboard again, and a key up is heard by whoever owns the keyboard when
            // it happens - as it always has been for a page that opened another on a key down. The
            // press is what closes things, and the press went to the dialog alone.
            "page: key up",
        ]);
        expect(game.layerStack.getState()).toEqual([]);

        expect(await game.pressEscape()).toEqual([
            "global: key down",
            "page: cancel",
            "page: key down",
            "page: key up",
        ]);
        expect(game.errors).toEqual([]);
    });

    it("a layer that is not modal never takes the keys from the page", async () => {
        const game = runningGame({ dialog: { modal: false } });

        expect(await game.pressEscape()).toEqual([
            "global: key down",
            "page: cancel",
            "page: key down",
            "page: key up",
        ]);
    });

    it("a modal layer still arriving hears nothing yet, and its keys do not fall to the page", async () => {
        const game = runningGame({ dialog: { modal: true }, dialogReady: false });

        expect(await game.pressEscape()).toEqual(["global: key down"]);
    });
});
