import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Blueprint, BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { collectBlueprintEventHeadNodeIdsForDispatch } from "@shared/types/blueprint/graph";
import { scriptLayerKey } from "@shared/blueprint/blueprintLayers";
import {
    getUIStructuralChildSlot,
    isUIStructuralWidgetPart,
    UI_DOCUMENT_SCHEMA_VERSION,
    uiElementTypeAcceptsChildren,
    uiElementTypeAcceptsUserChildren,
    type UIDocument,
    type UIElement,
} from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import type { WidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { blueprintNodeRegistry, isBlueprintNodeAllowedInGraphContext } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { buildBlueprintGraphContext } from "@/lib/ui-editor/blueprint-nodes/graphContext";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { dispatchBlueprintUiEvent, dispatchWidgetsBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { mountBlueprintCompiledScripts } from "@/lib/ui-editor/blueprint-runtime/mountBlueprintScripts";
import {
    scriptEventIdForWidgetSlot,
    scriptEventIdsForOwner,
    scriptEventsOfContributedLogicApi,
} from "@/lib/ui-editor/blueprint-runtime/script/scriptEventDispatch";
import { SCRIPT_EVENT_HEADS } from "@/lib/ui-editor/blueprint-runtime/script/scriptEvents";
import { mountCompiledScripts, unmountCompiledScripts } from "@/lib/ui-editor/blueprint-runtime/script/scriptRuntime";
import type { RuntimePluginGame } from "@/lib/ui-editor/runtime/plugins/runtimePluginApi";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { resolveNearestInsertParentInSurface } from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import { resolveNewElementParent } from "@/lib/ui-editor/tree/resolveAddTarget";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { renderStarterScript } from "@/lib/workspace/services/ui-editor/blueprint/blueprintFactories";
import { widgetMainOwnerKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { planMoveElementsInSurface } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { PluginWidgetModule } from "./pluginWidgetApi";
import { guardPluginWidgetModule } from "./pluginWidgetGuard";

/**
 * The two edges a plugin's widget still had after it could hold children and start its own graphs.
 *
 * 1. **A script layer did not hear the plugin's own heads.** A widget event on a head the plugin
 *    registered starts graphs in the widget's blueprint; a script layer beside those graphs was never
 *    called for it, and nothing - not the starter file, not the Dev Mode check, not the types - said
 *    what it would be called by. Now the event is a script event under its own id, and every one of
 *    those answers comes from the same derivation.
 * 2. **A plugin widget could not hold parts.** The Slider answer - "only the parts I built" - was a
 *    hard-coded table. A plugin widget now declares `partSlots`, read through the same contributed
 *    widget source every other capability lookup uses.
 *
 * Registered the way `app.services.widgets.register` registers one: through the guard, into the one
 * widget module registry the workspace has.
 */

const PLUGIN_ID = "probe.heads";
const RATING = `${PLUGIN_ID}.rating`;
const METER = `${PLUGIN_ID}.meter`;
const RATED_HEAD = `${PLUGIN_ID}.onRated`;
const MOUSE_CLICK_HEAD = "blueprint.event.head.mouseClick";

const RATING_LOGIC: WidgetLogicApi = {
    supportsPrivateBlueprint: true,
    events: [
        { id: "rated", displayName: "Rated", dispatchKind: "interaction", headNodeTypes: [RATED_HEAD] },
        { id: "mouseClick", displayName: "Mouse click", dispatchKind: "interaction", headNodeTypes: [MOUSE_CLICK_HEAD] },
        // Starts graphs, but `onRated-twice` is not a name a module can export.
        { id: "rated-twice", displayName: "Rated twice", dispatchKind: "interaction", headNodeTypes: [RATED_HEAD] },
        // Starts graphs, but a script on any widget is already called `onElementClick` for another thing.
        { id: "elementClick", displayName: "Clicked", dispatchKind: "interaction", headNodeTypes: [RATED_HEAD] },
    ],
    commands: [],
    readableState: [],
    writableProps: [],
};

function register(module: Partial<PluginWidgetModule> & { type: string }): void {
    const guarded = guardPluginWidgetModule(
        PLUGIN_ID,
        { displayName: module.type, createDefaultElement: () => ({}), render: () => null, ...module } as PluginWidgetModule,
        { log: vi.fn() } as unknown as RuntimePluginGame,
        { documentService: {} as UIDocumentService, stateService: {} as UIEditorStateService },
    );
    widgetModuleRegistry.register(guarded, { ownerPluginId: PLUGIN_ID, ownerPluginName: "Heads probe" });
}

beforeAll(() => {
    registerCoreBlueprintNodes();
    blueprintNodeRegistry.register({
        type: RATED_HEAD,
        displayName: "On Rated",
        category: "Events",
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        pins: [
            { id: "then", kind: "output", semantic: "exec", label: "Then" },
            { id: "stars", kind: "output", semantic: "data", valueType: "integer", label: "Stars" },
        ],
        execute: () => ({ nextPort: "then" }),
    }, { replaceExisting: true });
});

afterEach(() => {
    widgetModuleRegistry.unregister(RATING);
    widgetModuleRegistry.unregister(METER);
    unmountCompiledScripts();
    vi.restoreAllMocks();
});

function quietly(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

// ---------------------------------------------------------------------------
// 1. A script layer hears the plugin's own heads
// ---------------------------------------------------------------------------

/** Every event head the node palette offers this owner's blueprint. */
function headsThePaletteOffers(owner: BlueprintOwnerRef, widgetElementType: string): string[] {
    const context = buildBlueprintGraphContext({
        graphKind: "event",
        owner,
        widgetElementType,
        widgetBlueprintEvents: widgetModuleRegistry.get(widgetElementType)?.logicApi?.events,
        isComponentDefinitionGraph: owner.kind === "componentWidgetMain",
    });
    return blueprintNodeRegistry.list()
        .filter(def => (def.role === "eventHead" || def.role === "elementEventHead") && isBlueprintNodeAllowedInGraphContext(def, context))
        .map(def => def.type);
}

describe("a script layer on a plugin's widget", () => {
    const OWNERS: BlueprintOwnerRef[] = [
        { kind: "widgetMain", surfaceId: "page", elementId: "stars" },
        { kind: "componentWidgetMain", componentId: "card", elementId: "stars" },
    ];

    it.each(OWNERS)("is offered what a graph beside it is offered ($kind)", owner => {
        quietly();
        register({ type: RATING, logicApi: RATING_LOGIC });
        const offered = headsThePaletteOffers(owner, RATING);
        const exported = scriptEventIdsForOwner(owner, RATING);

        // The palette's built-in heads, as the script events they stand for, and the script's
        // built-in names: the same set - the rule `scriptEvents.test.ts` holds every built-in widget to.
        const builtinFromPalette = [...new Set(offered.filter(type => type in SCRIPT_EVENT_HEADS).map(type => SCRIPT_EVENT_HEADS[type]))].sort();
        const pluginNamed = new Set(scriptEventsOfContributedLogicApi(widgetModuleRegistry.get(RATING)!.logicApi)
            .events.filter(event => event.pluginHeadTypes).map(event => event.eventId));
        expect(exported.filter(id => !pluginNamed.has(id)).slice().sort()).toEqual(builtinFromPalette);

        // And the plugin's own head, offered in the palette, is a script event too - under the id of
        // the event it starts on.
        expect(offered).toContain(RATED_HEAD);
        expect(exported).toContain("rated");
        expect(scriptEventIdForWidgetSlot(RATING, "rated")).toBe("rated");
    });

    it("leaves out, and says so, an event whose id no module could export or another event already answers", () => {
        const warn = quietly();
        register({ type: RATING, logicApi: RATING_LOGIC });
        const exported = scriptEventIdsForOwner({ kind: "widgetMain", surfaceId: "page", elementId: "stars" }, RATING);

        expect(exported).not.toContain("rated-twice");
        expect(scriptEventIdForWidgetSlot(RATING, "rated-twice")).toBeNull();
        // The plugin's `elementClick` is not the Element Click every widget hears; the script keeps
        // the host's meaning of the name.
        expect(scriptEventIdForWidgetSlot(RATING, "elementClick")).toBeNull();

        const warned = warn.mock.calls.map(call => String(call[0]));
        expect(warned.some(line => line.includes('"rated-twice"') && line.includes("onRated-twice"))).toBe(true);
        expect(warned.some(line => line.includes('"elementClick"') && line.includes("onElementClick"))).toBe(true);
    });

    it("hears the ambient events a built-in widget hears, without the plugin declaring them", () => {
        quietly();
        register({ type: RATING, logicApi: RATING_LOGIC });
        const graph = { head: { type: "blueprint.event.head.anyKeyDown" } };
        // Before, `On Any Key Down` was offered in this widget's blueprint and never ran: key events
        // reach a widget through its own slot table, and a plugin's table did not list them.
        expect(collectBlueprintEventHeadNodeIdsForDispatch(graph, "keyDown", RATING)).toEqual(["head"]);
        expect(scriptEventIdForWidgetSlot(RATING, "windowFocusChanged")).toBe("windowFocusChanged");
    });

    it("writes a starter file that lists what it is called by and calls an event the widget has", () => {
        quietly();
        register({ type: RATING, logicApi: RATING_LOGIC });
        const starter = renderStarterScript({ owner: { kind: "widgetMain", surfaceId: "page", elementId: "stars" }, widgetType: RATING });

        expect(starter).toMatch(/^\/\/ Called from here: .*\bonRated\b/m);
        // No Init on this widget, so the starter does not write `onInit` - it would never be called.
        expect(starter).not.toContain("onInit");
        expect(starter).toContain(`WidgetCtx<"${RATING}">`);
    });
});

// ---------------------------------------------------------------------------
// ... and the dispatch calls it
// ---------------------------------------------------------------------------

const SURFACE_ID = "page";
const STARS_ID = "stars";
const LAYER_ID = "layer-script";
const BLUEPRINT_ID = "bp-stars";

function starsDocument(): UIDocument {
    return {
        surfaces: [{ id: SURFACE_ID, name: "Title", kind: "page", rootElementId: "root" }],
        elements: {
            root: { id: "root", type: "nl.root", childrenIds: [STARS_ID], parentId: null },
            [STARS_ID]: { id: STARS_ID, type: RATING, childrenIds: [], parentId: "root" },
        },
    } as unknown as UIDocument;
}

function starsBlueprint(): Blueprint {
    return {
        id: BLUEPRINT_ID,
        name: "Stars",
        owner: { kind: "widgetMain", surfaceId: SURFACE_ID, elementId: STARS_ID },
        graphs: {
            eventIds: [LAYER_ID],
            events: { [LAYER_ID]: { id: LAYER_ID, script: { scriptRef: "scripts/stars.ts" } } },
            functions: {},
        },
        members: { variables: {}, fields: {}, functions: {} },
        bindings: {},
    } as unknown as Blueprint;
}

function blueprintDocument(): BlueprintDocument {
    return {
        blueprints: { [BLUEPRINT_ID]: starsBlueprint() },
        ownerRecords: { [widgetMainOwnerKey(SURFACE_ID, STARS_ID)]: { blueprintId: BLUEPRINT_ID } },
    } as unknown as BlueprintDocument;
}

async function mountStars(module: Record<string, unknown>): Promise<void> {
    await mountCompiledScripts(
        { [scriptLayerKey(BLUEPRINT_ID, LAYER_ID)]: { scriptRef: "scripts/stars.ts", url: "file:///stars.mjs" } },
        undefined,
        async () => module,
    );
}

function dispatchOptions() {
    return {
        document: starsDocument(),
        blueprintDocument: blueprintDocument(),
        persistentVariables: {} as never,
        surfaceId: SURFACE_ID,
        hostAdapter: { blueprintRuntime: { hostApi: {} } } as unknown as UIHostAdapter,
        debug: new DebugBridge(),
        getSurfaceState: () => undefined,
        setSurfaceState: () => undefined,
    };
}

describe("a plugin widget's event reaches its script layer", () => {
    it("calls the export named by the event, with the payload the plugin raised", async () => {
        quietly();
        register({ type: RATING, logicApi: RATING_LOGIC });
        const seen: unknown[] = [];
        await mountStars({
            onRated: (_ctx: unknown, event: unknown) => seen.push(["rated", event]),
            onMouseClick: (_ctx: unknown, event: unknown) => seen.push(["click", event]),
        });

        const heard = await dispatchBlueprintUiEvent({
            ...dispatchOptions(),
            elementId: STARS_ID,
            eventName: "rated",
            eventPayload: { stars: 4 },
        });
        await dispatchBlueprintUiEvent({ ...dispatchOptions(), elementId: STARS_ID, eventName: "mouseClick", eventPayload: { x: 1, y: 2 } });

        expect(heard).toBe(true);
        expect(seen).toEqual([["rated", { stars: 4 }], ["click", { x: 1, y: 2 }]]);
    });

    it("calls it for an ambient event the plugin never declared", async () => {
        quietly();
        register({ type: RATING, logicApi: RATING_LOGIC });
        const seen: unknown[] = [];
        await mountStars({ onWindowFocusChanged: (_ctx: unknown, event: unknown) => seen.push(event) });

        await dispatchWidgetsBlueprintEvent({ ...dispatchOptions(), eventName: "windowFocusChanged", eventPayload: { isFocused: false } });

        expect(seen).toEqual([{ isFocused: false }]);
    });

    it("tells the author a plugin widget's script exports nothing it is called by, naming what it is", async () => {
        quietly();
        register({ type: RATING, logicApi: RATING_LOGIC });
        const bundle = {
            ui: {
                uidoc: starsDocument(),
                localBlueprints: blueprintDocument(),
                scripts: { [scriptLayerKey(BLUEPRINT_ID, LAYER_ID)]: { scriptRef: "scripts/stars.ts", url: "file:///stars.mjs" } },
            },
        } as unknown as DevModeBundle;
        const issues: string[] = [];

        await mountBlueprintCompiledScripts(bundle, issue => issues.push(issue.message), async () => ({ onRatd: () => undefined }));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain("onRatd");
        expect(issues[0]).toContain("onRated");
    });
});

// ---------------------------------------------------------------------------
// 2. A plugin widget's parts
// ---------------------------------------------------------------------------

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = [], extra?: Record<string, unknown>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 10, y: 10, width: 100, height: 100 }, ...(extra ? { extra } : {}) };
}

/** A page with a plugin meter holding its fill, and a text beside it. */
function pageWithMeter(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [{
            id: "page",
            name: "Page",
            host: "app",
            kind: "appSurface",
            designSize: { width: 640, height: 360 },
            rootElementId: "root",
        }],
        elements: {
            root: element("root", "nl.root", null, ["meter", "label"]),
            meter: element("meter", METER, "root", ["fill"]),
            fill: element("fill", "nl.container", "meter", [], { partSlot: "fill" }),
            label: element("label", "nl.text", "root"),
        },
    };
}

describe("a plugin widget that declares part slots", () => {
    it("holds the parts it built and nothing else, for as long as its plugin is loaded", () => {
        register({ type: METER, partSlots: ["fill"] });
        expect(uiElementTypeAcceptsChildren(METER)).toBe(true);
        expect(uiElementTypeAcceptsUserChildren(METER)).toBe(false);
        expect(getUIStructuralChildSlot(METER, { partSlot: "fill" })).toBe("fill");
        // A slot it did not declare, or no marker at all, is not one of its parts.
        expect(getUIStructuralChildSlot(METER, { partSlot: "needle" })).toBeNull();
        expect(getUIStructuralChildSlot(METER, undefined)).toBeNull();

        widgetModuleRegistry.unregister(METER);
        expect(uiElementTypeAcceptsChildren(METER)).toBe(false);
        expect(getUIStructuralChildSlot(METER, { partSlot: "fill" })).toBeNull();
    });

    it("refuses what an author tries to put in it, as a slider does", () => {
        register({ type: METER, partSlots: ["fill"] });
        const page = pageWithMeter();
        // Dragged onto it in the layer outline.
        expect(planMoveElementsInSurface(page, "page", ["label"], "meter", null)).toEqual({ ok: false, reason: "invalid_target" });
        // Drawn with the insert tool while it is selected: the new widget goes beside it instead.
        expect(resolveNewElementParent(page, "page", "meter")).toBe("root");
        // And beside it while its part is selected, where a paste also lands: the part is a container,
        // but it is the size of what the widget draws and clips what it holds, so a rectangle drawn on
        // the canvas would leave an element nobody can see.
        expect(resolveNewElementParent(pageWithMeter(), "page", "fill")).toBe("root");
        // Naming the part as the destination still puts it in - the outline's Insert Child on the part.
        expect(resolveNearestInsertParentInSurface(pageWithMeter(), "page", "fill")).toBe("fill");
    });

    it("keeps its part from being dragged out of it", () => {
        register({ type: METER, partSlots: ["fill"] });
        const page = pageWithMeter();
        expect(isUIStructuralWidgetPart(page, page.elements.fill)).toBe(true);
        const plan = planMoveElementsInSurface(page, "page", ["fill"], "root", null);
        expect(plan.ok).toBe(false);
    });

    it("answers as a widget with parts when it also says it accepts children, and says why", () => {
        const warn = quietly();
        register({ type: METER, partSlots: ["fill", "fill", ""], acceptsChildren: true });
        expect(uiElementTypeAcceptsUserChildren(METER)).toBe(false);
        expect(widgetModuleRegistry.get(METER)?.partSlots).toEqual(["fill"]);
        const warned = warn.mock.calls.map(call => String(call[0]));
        expect(warned.some(line => line.includes(METER) && line.includes("acceptsChildren is ignored"))).toBe(true);
        expect(warned.some(line => line.includes('part slot ""'))).toBe(true);
    });
});
