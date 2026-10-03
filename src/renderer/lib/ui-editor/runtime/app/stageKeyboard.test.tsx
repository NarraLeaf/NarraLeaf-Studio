// @vitest-environment jsdom
/**
 * The stage owns the keyboard while the story is what the player is looking at.
 *
 * Every key reached the window, and nothing on the stage was ever asked about it: the key dispatch
 * went to the global blueprint and to the page or modal layer that owned the keyboard, and with the
 * story on screen no page is drawn - the ones a game hides when it takes the screen are not ready -
 * so a key went nowhere. A dialogue box answering an action bound to Space was a binding that looked
 * wired and never fired, and a shipped game advanced on a click and on nothing else.
 *
 * What runs here is what a game runs, short of the engine: the slot surfaces drawn by the real slot
 * shell, which registers them as it does in a game; the real element tree, list renderer included;
 * the listener `GameApp` installs, on `window`, for real key events; and `GameApp`'s rule for who
 * owns the keyboard - the page when one is drawn over the stage, the stage when the story is on
 * screen, nobody otherwise. What is asserted is which graphs answered.
 *
 * Comments in English per project convention.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
} from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
    type UISurface,
    type UIStageSlotId,
    type UIStageSurface,
} from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createRecordingCore, ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { blueprintDocumentOf, graphOf, type GraphNode } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import type { AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";
import { AmbientSurfaceTargets } from "./ambientSurfaceEvents";
import type { GameHostCapabilities } from "./gameHostApiOptions";
import { buildPageHostAdapterBundle, cacheHostAdapterBundles, type PageHostInputs } from "./hostAdapterBundles";
import { listenForGameKeys, type KeyboardOwner } from "./keyboardOwner";
import type { EngineNvlKeys } from "./engineNvlKeys";
import { StageCoveredContext } from "./stageConcealment";
import { SurfaceLifecycleOrchestrator } from "./lifecycle/surfaceLifecycleOrchestrator";
import {
    StageSlotSurfaceBody,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";

const TITLE = "title";
const DIALOGUE = "dialogue";
const CHOICE = "choice";
const NOTIFICATIONS = "notifications";
/** The starter project's own action, with the starter project's own bindings. */
const ADVANCE = "advance";

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more: Partial<UIElement> = {}): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 400, height: 40, visible: true }, ...more };
}

function slotSurface(id: string, slotId: UIStageSlotId, rootElementId: string, answers: boolean): UIStageSurface {
    return {
        id,
        name: id,
        kind: "stageSurface",
        mount: { kind: "stageSlot", slotId },
        designSize: { width: 1280, height: 720 },
        rootElementId,
        settings: { backgroundColor: "transparent" },
        ...(answers ? { actions: [{ actionId: ADVANCE }] } : {}),
    } as unknown as UIStageSurface;
}

const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    actions: {
        [ADVANCE]: {
            id: ADVANCE,
            name: "Advance",
            bindings: [
                { kind: "pointer", gesture: "click" },
                { kind: "key", key: "Space" },
                { kind: "key", key: "Enter" },
            ],
        },
    },
    surfaces: [
        { id: TITLE, name: "Title", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "titleRoot" },
        slotSurface(DIALOGUE, "dialog", "dialogueRoot", true),
        slotSurface(CHOICE, "choice", "choiceRoot", false),
        // Display-only, and answering Advance anyway: it must still hear nothing.
        slotSurface(NOTIFICATIONS, "notification", "notificationsRoot", true),
    ],
    elements: {
        titleRoot: element("titleRoot", "nl.root", null, [], { layout: { x: 0, y: 0, width: 1280, height: 720 } }),
        dialogueRoot: element("dialogueRoot", "nl.root", null, ["line", "boxButton"], { layout: { x: 0, y: 0, width: 1280, height: 720 } }),
        line: element("line", "nl.text", "dialogueRoot", [], { props: { text: "A line." } }),
        boxButton: element("boxButton", "nl.button", "dialogueRoot", [], { props: { label: "Log" } }),
        choiceRoot: element("choiceRoot", "nl.root", null, ["options"], { layout: { x: 0, y: 0, width: 1280, height: 720 } }),
        options: element("options", "nl.choice.list", "choiceRoot", ["option"], {
            layout: { x: 0, y: 0, width: 600, height: 300, visible: true },
            props: {
                itemStructId: "nl.choiceItem",
                itemKeyFieldId: "index",
                items: [
                    { text: "First", index: 0, disabled: false },
                    { text: "Second", index: 1, disabled: false },
                    { text: "Third", index: 2, disabled: false },
                ],
            },
        }),
        option: element("option", "nl.container", "options", [], {
            layout: { x: 0, y: 0, width: 600, height: 60, visible: true },
            extra: { listSlot: "itemTemplate" },
        }),
        notificationsRoot: element("notificationsRoot", "nl.root", null, [], { layout: { x: 0, y: 0, width: 1280, height: 720 } }),
    },
} as unknown as UIDocument;

const surfaceById = (id: string) => document.surfaces.find(surface => surface.id === id)!;

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

function logs(head: GraphNode, line: string) {
    return graphOf({
        nodes: { head, log: { type: BLUEPRINT_NODE_TYPE_LOG, params: { value: line } } },
        exec: ["head", "log"],
    });
}

const onAdvance: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, params: { actionId: ADVANCE } };
const onSpace: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN, params: { key: "Space" } };

const blueprints: readonly Blueprint[] = [
    // The dialogue box: Advance is what the starter project answers with Next.
    blueprintOn("bp-dialogue", { kind: "surfaceMain", surfaceId: DIALOGUE }, {
        advance: logs(onAdvance, "dialogue: advance"),
        space: logs(onSpace, "dialogue: key down"),
    }),
    blueprintOn("bp-notifications", { kind: "surfaceMain", surfaceId: NOTIFICATIONS }, {
        advance: logs(onAdvance, "notifications: advance"),
        space: logs(onSpace, "notifications: key down"),
    }),
    // A widget on the stage with a key head of its own: it hears the window, not the dispatch.
    blueprintOn("bp-box-button", { kind: "widgetMain", surfaceId: DIALOGUE, elementId: "boxButton" }, {
        escape: logs({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN, params: { key: "Escape" } }, "dialogue button: Escape"),
    }),
    blueprintOn("bp-title", { kind: "surfaceMain", surfaceId: TITLE }, {
        space: logs(onSpace, "title: key down"),
    }),
    // The choice list picks the option it was told to pick, and says which.
    blueprintOn("bp-options", { kind: "widgetMain", surfaceId: CHOICE, elementId: "options" }, {
        pick: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK },
                asText: { type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
                log: { type: BLUEPRINT_NODE_TYPE_LOG },
            },
            exec: ["head", "log"],
            data: [
                ["head", "index", "asText", "value"],
                ["asText", "result", "log", "value"],
            ],
        }),
    }),
];

const running: Array<() => void> = [];
let sessionCount = 0;

/**
 * What `GameApp` answers per press: the page when one is drawn over the stage, else the stage when the
 * story is on screen - with the engine's NVL page standing in for the dialogue box in an NVL passage.
 */
type Screen = "title" | "story" | "page over the story" | "engine NVL";

function runningGame() {
    sessionCount += 1;
    const core = createRecordingCore([]);
    const blueprintDocument = blueprintDocumentOf(blueprints);
    const bundle: DevModeBundle = {
        bundleId: "bundle",
        revision: 1,
        timestamp: "2026-09-30T00:00:00.000Z",
        ui: {
            uidoc: document,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
            localBlueprints: blueprintDocument,
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    };
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
    const widgetRuntimeStore = new WidgetRuntimeStateStore();
    const capabilities = {
        onOpenSurface: async () => undefined,
        onPageBack: async () => undefined,
        widgetRuntimeStore,
        localizationConfig: null,
        voiceConfig: null,
    } as unknown as GameHostCapabilities;
    const stageKeyboardSurfaces = new AmbientSurfaceTargets();
    const slotOptions = {
        sessionId: `session-${sessionCount}`,
        core,
        bundle,
        rendererRegistry: new ElementRendererRegistry(BuiltinElementRenderers),
        lifecycleRef: { current: new SurfaceLifecycleOrchestrator() },
        makeStateAccessors: (runtimeScopeId: string) => {
            const store = core.scopeBridge.getSurfaceStore(runtimeScopeId);
            return { get: (key: string) => store.get(key), set: (key: string, value: unknown) => store.set(key, value) };
        },
        host: capabilities,
        startStory: async () => undefined,
        setWidgetPatchesByScope: () => undefined,
        widgetPatchesByScopeRef: { current: {} as WidgetPatchesByScope },
        ambientSurfaces: new AmbientSurfaceTargets(),
        stageKeyboardSurfaces,
    } as unknown as GameUiSlotHostOptions;

    const pageInputs: PageHostInputs = {
        core,
        capabilities,
        bundle,
        startStory: async () => undefined,
        widgetPatches: { setByScope: () => undefined, byScopeRef: { current: {} as WidgetPatchesByScope } },
    };
    const hostAdapterBundleFor = cacheHostAdapterBundles((entry, surface) => buildPageHostAdapterBundle(pageInputs, entry, surface));
    const title: AppSurfaceLayerNavEntry = {
        key: `${TITLE}:1`,
        runtimeScopeId: `${TITLE}:1`,
        surfaceId: TITLE,
        direction: "forward",
        waitForExit: false,
        props: {},
        presentation: "appPage",
    };
    core.executionManager.openScope(title.runtimeScopeId);
    const titleSurface = surfaceById(TITLE) as UISurface;
    const titleHost = hostAdapterBundleFor(title, titleSurface)!;

    let screen: Screen = "story";
    /** Each time the engine's NVL page was read on. */
    const nvlAdvances: string[] = [];
    const engineNvl: EngineNvlKeys = { actionIds: new Set([ADVANCE]), advance: () => { nvlAdvances.push("advance"); } };
    const readKeyboardOwner = (): KeyboardOwner | null => {
        if (screen === "title" || screen === "page over the story") {
            return { surface: titleSurface, host: titleHost };
        }
        return { stage: stageKeyboardSurfaces.list(), ...(screen === "engine NVL" ? { engineNvl } : {}) };
    };
    running.push(listenForGameKeys(window, {
        blueprintDocument,
        persistentVariables: {},
        vocabulary: document.actions,
        core,
        globalHost: titleHost,
        readKeyboardOwner,
        onError: error => errors.push(String(error)),
    }));

    const settle = async () => {
        await act(async () => {
            for (let turn = 0; turn < 10; turn++) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        });
    };
    /** Press and release a key where the player's focus is, as the browser delivers it. */
    const press = async (key: string, options: { target?: EventTarget; repeat?: boolean } = {}) => {
        lines.length = 0;
        const target = options.target ?? window;
        const init = { key, bubbles: true, cancelable: true, repeat: options.repeat === true };
        target.dispatchEvent(new KeyboardEvent("keydown", init));
        await settle();
        target.dispatchEvent(new KeyboardEvent("keyup", init));
        await settle();
        return [...lines].sort();
    };

    return {
        slotOptions,
        stageKeyboardSurfaces,
        nvlAdvances,
        lines,
        errors,
        press,
        settle,
        showing: (next: Screen) => {
            screen = next;
        },
    };
}

/** One slot surface as the slot component draws it in a game. */
function SlotDrawing(props: { options: GameUiSlotHostOptions; surfaceId: string; slotId: UIStageSlotId; passive?: boolean }) {
    const surface = surfaceById(props.surfaceId) as UIStageSurface;
    const runtime = useStageSlotSurfaceRuntime({ options: props.options, surface, slotId: props.slotId });
    return <StageSlotSurfaceBody options={props.options} surface={surface} runtime={runtime} passive={props.passive} />;
}

/**
 * The stage of the starter project mid-story: the dialogue box, and the notifications slot. `covered`
 * is `GameApp`'s answer to whether a page or a modal layer is drawn over it.
 */
function Stage(props: { options: GameUiSlotHostOptions; menu?: boolean; covered?: boolean }) {
    return (
        <StageCoveredContext.Provider value={props.covered === true}>
            <SlotDrawing options={props.options} surfaceId={DIALOGUE} slotId="dialog" />
            {props.menu ? <SlotDrawing options={props.options} surfaceId={CHOICE} slotId="choice" /> : null}
            <SlotDrawing options={props.options} surfaceId={NOTIFICATIONS} slotId="notification" passive />
        </StageCoveredContext.Provider>
    );
}

beforeAll(() => {
    registerCoreBlueprintNodes();
    installResizeObserverStub();
    ensureAnimationFramePolyfill();
});

afterEach(() => {
    for (const stop of running.splice(0)) {
        stop();
    }
    cleanup();
});

async function onStage(menu = false) {
    const game = runningGame();
    const view = render(<Stage options={game.slotOptions} menu={menu} />);
    const expected = menu ? [DIALOGUE, CHOICE] : [DIALOGUE];
    await waitFor(() => expect(game.stageKeyboardSurfaces.list().map(target => target.surface.id)).toEqual(expected));
    return { game, view };
}

describe("the keys on the stage", () => {
    it("advances on Space and on Enter, once a press, through the dialogue box's Advance", async () => {
        const { game } = await onStage();

        expect(await game.press(" ")).toEqual(["dialogue: advance", "dialogue: key down"]);
        expect(await game.press("Enter")).toEqual(["dialogue: advance"]);
        expect(game.errors).toEqual([]);
    });

    it("does nothing with a key Advance is not bound to", async () => {
        const { game } = await onStage();

        for (const key of ["ArrowDown", "ArrowRight", "PageDown", "a"]) {
            expect(await game.press(key)).toEqual([]);
        }
    });

    it("leaves a display-only slot out: it answers no key, as it answers no click", async () => {
        const { game } = await onStage();

        const heard = await game.press(" ");

        expect(heard.filter(line => line.startsWith("notifications:"))).toEqual([]);
    });

    it("hands the keys to a page drawn over the story, and nothing on the stage hears them under it", async () => {
        const { game, view } = await onStage();
        game.showing("page over the story");
        view.rerender(<Stage options={game.slotOptions} covered />);

        expect(await game.press(" ")).toEqual(["title: key down"]);
        expect(await game.press("Enter")).toEqual([]);
        // The widget's own key head included: it listens on the window, and used to go on answering
        // every key the page took - Escape closing the page and pressing a button under it at once.
        expect(await game.press("Escape")).toEqual([]);

        game.showing("story");
        view.rerender(<Stage options={game.slotOptions} />);
        expect(await game.press(" ")).toEqual(["dialogue: advance", "dialogue: key down"]);
        expect(await game.press("Escape")).toEqual(["dialogue button: Escape"]);
    });

    it("reads the engine's NVL page on with the keys that read the dialogue box on, once a press", async () => {
        const game = runningGame();
        game.showing("engine NVL");

        await game.press(" ");
        await game.press("Enter");
        expect(game.nvlAdvances).toEqual(["advance", "advance"]);

        // Not with a key Advance is not bound to, and not with the system's repeats of a held key.
        await game.press("a");
        await game.press(" ", { repeat: true });
        expect(game.nvlAdvances).toEqual(["advance", "advance"]);

        // Nor with a page over it: the page has the keys.
        game.showing("page over the story");
        await game.press(" ");
        expect(game.nvlAdvances).toEqual(["advance", "advance"]);
        expect(game.errors).toEqual([]);
    });

    it("answers a key held down once: the system's repeats reach neither the action nor the key head", async () => {
        const { game } = await onStage();

        expect(await game.press(" ")).toEqual(["dialogue: advance", "dialogue: key down"]);
        expect(await game.press(" ", { repeat: true })).toEqual([]);
        expect(await game.press(" ", { repeat: true })).toEqual([]);
        // Let go and press again: that is a second press.
        expect(await game.press(" ")).toEqual(["dialogue: advance", "dialogue: key down"]);
    });

    it("keeps a text field's keys", async () => {
        const { game } = await onStage();
        const field = window.document.createElement("input");
        field.type = "text";
        window.document.body.appendChild(field);

        expect(await game.press(" ", { target: field })).toEqual([]);
        expect(await game.press("Enter", { target: field })).toEqual([]);
        field.remove();
    });

    it("gives Enter and Space to the button that has the focus, and the story does not advance as well", async () => {
        const { game } = await onStage();
        // A button of the platform's own, which acts on the key once the event has finished...
        const native = window.document.createElement("button");
        window.document.body.appendChild(native);
        // ...and one drawn the way a game draws its buttons, which acts on it and says so.
        const drawn = window.document.createElement("div");
        drawn.setAttribute("role", "button");
        drawn.tabIndex = 0;
        drawn.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
            }
        });
        window.document.body.appendChild(drawn);

        for (const target of [native, drawn]) {
            expect(await game.press(" ", { target })).toEqual(["dialogue: key down"]);
            expect(await game.press("Enter", { target })).toEqual([]);
        }
        native.remove();
        drawn.remove();
    });

    it("lets a choice be reached, moved between and picked with the keys, and picking does not advance the story too", async () => {
        const { game, view } = await onStage(true);
        const rowAt = (index: number) =>
            view.container.querySelector<HTMLElement>(`[data-ui-surface-id='${CHOICE}'] [data-ui-list-item-index='${index}']`)!;
        await waitFor(() => expect(rowAt(2)).not.toBeNull());

        // One stop on Tab for the whole menu: the first option.
        expect([0, 1, 2].map(index => rowAt(index).tabIndex)).toEqual([0, -1, -1]);

        act(() => rowAt(0).focus());
        await game.press("ArrowDown", { target: rowAt(0) });
        expect(window.document.activeElement).toBe(rowAt(1));
        expect([0, 1, 2].map(index => rowAt(index).tabIndex)).toEqual([-1, 0, -1]);
        await game.press("End", { target: rowAt(1) });
        expect(window.document.activeElement).toBe(rowAt(2));
        await game.press("ArrowUp", { target: rowAt(2) });
        expect(window.document.activeElement).toBe(rowAt(1));

        expect(await game.press("Enter", { target: rowAt(1) })).toEqual(["1"]);
        expect(await game.press(" ", { target: rowAt(1) })).toEqual(["1", "dialogue: key down"]);
        // Held on an option, the repeats pick nothing more and advance nothing.
        expect(await game.press("Enter", { target: rowAt(1), repeat: true })).toEqual([]);
        expect(game.errors).toEqual([]);
    });
});
