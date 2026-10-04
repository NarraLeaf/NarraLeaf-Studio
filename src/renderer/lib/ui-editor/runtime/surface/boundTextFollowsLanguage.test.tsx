// @vitest-environment jsdom
/**
 * A label bound to a value blueprint that translates something shows the player's language - after
 * the player changes it, too.
 *
 * The case it exists for is a settings row: "3 s" in English, "3 秒" in Chinese, a number formatted
 * into a translated template. That needs a key read inside a Blueprint Value, which the pure
 * `Translation Key Text` makes possible, and it needs the binding to run again when the language
 * changes, which is the half pinned here. Choosing a language on the title screen does not restart
 * the game, so nothing remounts the page: a binding that did not record the language as something it
 * read would keep the old word, beside key-bound labels that had already switched.
 *
 * Drawn through the real tree, with the language source and the host API a game builds, and the
 * language changed both ways a game changes it: a `Set Language` node and a direct store write (the
 * boot-time match against the system language, a language kept for the next launch being promoted).
 *
 * Comments in English per project convention.
 */
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_RETURN,
    BLUEPRINT_NODE_TYPE_LITERAL_INTEGER,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_KEY_TEXT,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_SET_LANGUAGE,
    BLUEPRINT_NODE_TYPE_STRING_FORMAT,
} from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import { LOCALE_STORAGE_KEY, type GameLocalizationBundle } from "@shared/types/localization";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { uiTextSiteOf } from "@shared/types/ui-editor/textSource";
import { createBlueprintFnRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import { createDevModeBlueprintHostApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { dispatchSurfaceBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import {
    GameLocalizationContext,
    useLocalizedWidgetText,
    type GameLocalizationRuntime,
} from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import { setRuntimeLocaleSource } from "@/lib/ui-editor/runtime/localization/runtimeLocale";
import { blueprintDocumentOf, graphOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { SurfaceElementTree } from "./SurfaceElementTree";

const PAGE = "page";
const PAGE_BP = "bp-page";

const localization: GameLocalizationBundle = {
    sourceLocale: "en",
    locales: [
        { code: "en", displayName: "English" },
        { code: "zh-CN", displayName: "简体中文" },
    ],
    tables: {
        "zh-CN": { "key:seconds": "{0} 秒", "key:title": "设置" },
    },
    keys: { seconds: "{0} s", title: "Config" },
};

/** Which text shows what. */
const SHOWS = {
    /** `Format(Translation Key Text(seconds), [3])` in a Blueprint Value. */
    formatted: "formatted-text",
    /** The same key read inside a Fn the Blueprint Value calls. */
    throughFn: "fn-text",
    /** An ordinary label with a translation key, drawn through the game's localization context. */
    keyed: "keyed-text",
} as const;

const surface: UISurface = {
    id: PAGE,
    name: PAGE,
    host: "app",
    kind: "appSurface",
    designSize: { width: 640, height: 360 },
    rootElementId: `${PAGE}-root`,
} as UISurface;

function boundText(id: string): UIElement {
    return {
        id,
        type: "nl.text",
        parentId: `${PAGE}-root`,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 200, height: 20 },
        props: { text: "SAMPLE" },
        valueBindings: { text: { kind: "blueprintValue", blueprintId: `bp-value-${id}`, valueType: "string" } },
    };
}

const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface],
    elements: {
        [`${PAGE}-root`]: {
            id: `${PAGE}-root`,
            type: "nl.root",
            parentId: null,
            childrenIds: [SHOWS.formatted, SHOWS.throughFn, SHOWS.keyed],
            layout: { x: 0, y: 0, width: 640, height: 360 },
        },
        [SHOWS.formatted]: boundText(SHOWS.formatted),
        [SHOWS.throughFn]: boundText(SHOWS.throughFn),
        [SHOWS.keyed]: {
            id: SHOWS.keyed,
            type: "nl.text",
            parentId: `${PAGE}-root`,
            childrenIds: [],
            layout: { x: 0, y: 40, width: 200, height: 20 },
            props: { text: "Config", localizationKey: "title" },
        },
    },
} as unknown as UIDocument;

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

function valueOwner(elementId: string): BlueprintOwnerRef {
    return { kind: "widgetValue", surfaceId: PAGE, elementId, propPath: "text" };
}

const blueprints: readonly Blueprint[] = [
    blueprintOn(`bp-value-${SHOWS.formatted}`, valueOwner(SHOWS.formatted), {
        init: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                template: { type: BLUEPRINT_NODE_TYPE_LOCALIZATION_KEY_TEXT, params: { key: "seconds" } },
                three: { type: BLUEPRINT_NODE_TYPE_LITERAL_INTEGER, params: { value: 3 } },
                values: { type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY, params: { __jsonArrayInputPins: ["item_1"] } },
                format: { type: BLUEPRINT_NODE_TYPE_STRING_FORMAT },
                ret: { type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE },
            },
            exec: ["head", "ret"],
            data: [
                ["template", "value", "format", "template"],
                ["three", "value", "values", "item_1"],
                ["values", "result", "format", "values"],
                ["format", "result", "ret", "value"],
            ],
        }),
    }),
    blueprintOn(`bp-value-${SHOWS.throughFn}`, valueOwner(SHOWS.throughFn), {
        init: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                call: {
                    type: BLUEPRINT_NODE_TYPE_FN_CALL,
                    params: {
                        [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef(PAGE_BP, "unit"),
                        __fnSignatureSnapshot: {
                            name: "unit",
                            params: [],
                            returns: [{ pinId: "ret_1_value", name: "value", valueType: "string" }],
                        },
                    },
                },
                ret: { type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE },
            },
            exec: ["head", "call", "ret"],
            data: [["call", "ret_1_value", "ret", "value"]],
        }),
    }),
    blueprintOn(PAGE_BP, { kind: "surfaceMain", surfaceId: PAGE }, {
        unit: graphOf({
            nodes: {
                unit: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "unit" } },
                read: { type: BLUEPRINT_NODE_TYPE_LOCALIZATION_KEY_TEXT, params: { key: "seconds" } },
                ret: { type: BLUEPRINT_NODE_TYPE_FN_RETURN, params: { __fnReturnPinIds: ["ret_1_value"] } },
            },
            exec: ["unit", "ret"],
            data: [["read", "value", "ret", "ret_1_value"]],
        }),
        // A language button, as a settings page has one.
        switchToChinese: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED },
                set: { type: BLUEPRINT_NODE_TYPE_LOCALIZATION_SET_LANGUAGE, params: { language: "zh-CN" } },
            },
            exec: ["head", "set"],
        }),
    }),
];

const blueprintDocument = blueprintDocumentOf(blueprints);

const bundle = {
    bundleId: "bundle",
    revision: 1,
    timestamp: "2026-10-03T00:00:00.000Z",
    localization,
    ui: {
        uidoc: document,
        uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
        localBlueprints: blueprintDocument,
        persistentVariables: {},
        savedVariables: {},
        saveSchema: [],
    },
} as unknown as DevModeBundle;

/** A text widget that draws its words the way the shipped one does: through the game's localization. */
function GameText(props: { element: UIElement }) {
    const site = uiTextSiteOf("nl.text")!;
    const elementProps = (props.element.props ?? {}) as Record<string, unknown>;
    const words = useLocalizedWidgetText({
        site,
        elementId: props.element.id,
        sourceText: String(elementProps.text ?? ""),
        localizationKey: typeof elementProps.localizationKey === "string" ? elementProps.localizationKey : undefined,
    });
    return <span data-text={props.element.id}>{words}</span>;
}

let runCount = 0;

/** One running game, built the way `GameApp` builds one, playing in `startLocale`. */
function runningGame(startLocale: string) {
    runCount += 1;
    const scope = new ScopeStoreBridge();
    scope.persistenceSetSessionOnly(LOCALE_STORAGE_KEY, startLocale);
    const readLocale = (): string => {
        const stored = scope.persistenceGet(LOCALE_STORAGE_KEY);
        return typeof stored === "string" && stored ? stored : localization.sourceLocale;
    };
    const releaseLocale = setRuntimeLocaleSource({ getLocale: readLocale, sourceLocale: localization.sourceLocale });
    const localizationRuntime: GameLocalizationRuntime = {
        bundle: localization,
        getLocale: readLocale,
        subscribe: listener => scope.subscribePersistence(listener),
    };
    const debug = new DebugBridge();
    const errors: string[] = [];
    debug.subscribeEvents(event => {
        if (event.type === "execution.error") {
            errors.push(event.message);
        }
    });
    const widgetRuntimeStore = new WidgetRuntimeStateStore();
    const runtimeScopeId = `${PAGE}#${runCount}`;

    function host(): UIHostAdapter {
        let adapter: UIHostAdapter | null = null;
        const hostApi = createDevModeBlueprintHostApi({
            document,
            scope,
            activeSurfaceId: PAGE,
            runtimeScopeId,
            pageProps: {},
            emit: event => debug.emit(event),
            onOpenSurface: () => undefined,
            onPageBack: () => undefined,
            onWidgetPatch: () => undefined,
            widgetRuntimeStore,
            localizationConfig: localization,
            resolveHostAdapter: () => adapter,
        } as Parameters<typeof createDevModeBlueprintHostApi>[0]);
        adapter = createDevModeBlueprintHostAdapter({
            bundle,
            surface,
            runtimeScopeId,
            scopeBridge: scope,
            debug,
            hostApi,
        });
        return adapter;
    }

    const registry = new ElementRendererRegistry([
        { type: "nl.root", render: props => <>{props.children}</> },
        { type: "nl.text", render: props => <GameText element={props.element} /> },
    ]);
    const view = render(
        <StrictMode>
            <GameLocalizationContext.Provider value={localizationRuntime}>
                <SurfaceElementTree
                    document={document}
                    surface={surface}
                    rootElement={document.elements[surface.rootElementId]!}
                    rendererRegistry={registry}
                    hostAdapter={host()}
                    blueprintBindingContext={{
                        blueprintDocument,
                        persistentVariables: {},
                        surfaceState: scope.getSurfaceStore(runtimeScopeId),
                        debug,
                        coalescer: new BindingDebugCoalescer(),
                        globalState: {
                            get: key => scope.globalGet(key),
                            subscribe: listener => scope.subscribeGlobals(listener),
                        },
                    }}
                    editorChrome={false}
                />
            </GameLocalizationContext.Provider>
        </StrictMode>,
    );

    const state = new Map<string, unknown>();
    return {
        errors,
        shown: (textId: string) => view.container.querySelector(`[data-text="${textId}"]`)?.textContent ?? null,
        /** What the store holds now, as the boot-time match or a promoted next-launch language writes it. */
        writeLocale: (code: string) => scope.persistenceSet(LOCALE_STORAGE_KEY, code),
        /** The page's own blueprint, run on a host of its own, as a button press runs it. */
        page: (eventName: string, eventPayload: Record<string, unknown> = {}) =>
            dispatchSurfaceBlueprintEvent({
                blueprintDocument,
                persistentVariables: {},
                surfaceId: PAGE,
                runtimeScopeId,
                eventName,
                eventPayload,
                hostAdapter: host(),
                debug,
                getSurfaceState: (key: string) => state.get(key),
                setSurfaceState: (key: string, value: unknown) => {
                    state.set(key, value);
                },
            }),
        dispose: () => {
            view.unmount();
            releaseLocale();
        },
    };
}

/** Value graphs are async; let every evaluation, and every re-render it asks for, finish. */
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    }
}

beforeAll(() => {
    registerCoreBlueprintNodes();
    if (typeof globalThis.ResizeObserver === "undefined") {
        globalThis.ResizeObserver = class {
            public observe(): void {}
            public unobserve(): void {}
            public disconnect(): void {}
        } as unknown as typeof ResizeObserver;
    }
});

let game: ReturnType<typeof runningGame> | null = null;

afterEach(() => {
    game?.dispose();
    game = null;
    cleanup();
});

describe("a label bound to a translated value", () => {
    it("starts out in the player's language", async () => {
        game = runningGame("zh-CN");
        await settle();

        expect(game.shown(SHOWS.formatted)).toBe("3 秒");
        expect(game.shown(SHOWS.throughFn)).toBe("{0} 秒");
        expect(game.shown(SHOWS.keyed)).toBe("设置");
        expect(game.errors).toEqual([]);
    });

    it("changes language with the key-bound labels when the language is written", async () => {
        game = runningGame("zh-CN");
        await settle();

        await act(async () => {
            await game!.writeLocale("en");
        });
        await settle();

        expect(game.shown(SHOWS.keyed)).toBe("Config");
        expect(game.shown(SHOWS.formatted)).toBe("3 s");
        expect(game.shown(SHOWS.throughFn)).toBe("{0} s");
        expect(game.errors).toEqual([]);
    });

    it("changes language when a Set Language node picks one", async () => {
        game = runningGame("en");
        await settle();
        expect(game.shown(SHOWS.formatted)).toBe("3 s");

        await act(async () => {
            await game!.page("windowFocusChanged", { isFocused: true });
        });
        await settle();

        expect(game.shown(SHOWS.keyed)).toBe("设置");
        expect(game.shown(SHOWS.formatted)).toBe("3 秒");
        expect(game.shown(SHOWS.throughFn)).toBe("{0} 秒");
        expect(game.errors).toEqual([]);
    });
});
