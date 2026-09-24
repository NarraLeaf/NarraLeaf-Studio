import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { isBlueprintEventDispatchHeadType } from "@shared/types/blueprint/graph";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    uiElementTypeAcceptsChildren,
    uiElementTypeAcceptsUserChildren,
    type UIDocument,
    type UIElement,
} from "@shared/types/ui-editor/document";
import { uiElementOwnsChildAnimationTiming } from "@shared/types/ui-editor/elementAnimation";
import { getWidgetLogicApi, type WidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { blueprintNodeRegistry, isBlueprintNodeAllowedInGraphContext } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { buildBlueprintGraphContext } from "@/lib/ui-editor/blueprint-nodes/graphContext";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import type { RuntimePluginGame } from "@/lib/ui-editor/runtime/plugins/runtimePluginApi";
import { resolveNewElementParent } from "@/lib/ui-editor/tree/resolveAddTarget";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { planMoveElementsInSurface } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { PluginWidgetModule } from "./pluginWidgetApi";
import { guardPluginWidgetModule } from "./pluginWidgetGuard";

/**
 * The two places a plugin's widget was second to a built-in one, and nothing on the interface said so.
 *
 * Both are declarations the plugin API already invited - `logicApi` on the widget module, and now
 * `acceptsChildren` - that every seam asking the question read from tables written for the built-in
 * widgets alone. Registered here the way `app.services.widgets.register` registers one: through the
 * guard, into the one widget module registry the workspace has.
 */

const PLUGIN_ID = "probe.seams";
const BOX = `${PLUGIN_ID}.box`;
const RATING = `${PLUGIN_ID}.rating`;
const RATED_HEAD = `${PLUGIN_ID}.onRated`;
const MOUSE_CLICK_HEAD = "blueprint.event.head.mouseClick";

const RATING_LOGIC: WidgetLogicApi = {
    supportsPrivateBlueprint: true,
    events: [
        { id: "rated", displayName: "Rated", dispatchKind: "interaction", headNodeTypes: [RATED_HEAD] },
        { id: "mouseClick", displayName: "Mouse click", dispatchKind: "interaction", headNodeTypes: [MOUSE_CLICK_HEAD] },
        // Names a node Studio defines and a node another plugin would own: neither is this plugin's.
        { id: "stolen", displayName: "Stolen", dispatchKind: "interaction", headNodeTypes: ["blueprint.sound.play", "other.plugin.head"] },
        // Names nothing a graph could start on.
        { id: "headless", displayName: "Headless", dispatchKind: "interaction" },
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
    widgetModuleRegistry.register(guarded, { ownerPluginId: PLUGIN_ID, ownerPluginName: "Seams probe" });
}

afterEach(() => {
    widgetModuleRegistry.unregister(BOX);
    widgetModuleRegistry.unregister(RATING);
    vi.restoreAllMocks();
});

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 10, y: 10, width: 100, height: 100 } };
}

/** A page with a plugin box and, beside it, a text an author wants to put inside the box. */
function pageWithBox(): UIDocument {
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
            root: element("root", "nl.root", null, ["box", "label"]),
            box: element("box", BOX, "root"),
            label: element("label", "nl.text", "root"),
        },
    };
}

describe("a plugin widget that declares it holds children", () => {
    it("is a parent to every document rule, for as long as its plugin is loaded", () => {
        expect(uiElementTypeAcceptsUserChildren(BOX)).toBe(false);

        register({ type: BOX, acceptsChildren: true });
        expect(uiElementTypeAcceptsChildren(BOX)).toBe(true);
        expect(uiElementTypeAcceptsUserChildren(BOX)).toBe(true);
        // The child-timing half of the animation editor is offered by the same answer.
        expect(uiElementOwnsChildAnimationTiming(BOX)).toBe(true);

        widgetModuleRegistry.unregister(BOX);
        expect(uiElementTypeAcceptsUserChildren(BOX)).toBe(false);
    });

    it("stays a leaf when it does not say so", () => {
        register({ type: BOX });
        expect(uiElementTypeAcceptsChildren(BOX)).toBe(false);
    });

    it("receives what is drawn on the canvas while it is selected", () => {
        register({ type: BOX, acceptsChildren: true });
        // The insert tool puts a new widget in the selected element when that element takes one,
        // and walks up to the page otherwise.
        expect(resolveNewElementParent(pageWithBox(), "page", "box")).toBe("box");
    });

    it("receives an element dropped on it in the layer outline", () => {
        register({ type: BOX, acceptsChildren: true });
        const plan = planMoveElementsInSurface(pageWithBox(), "page", ["label"], "box", null);
        expect(plan.ok).toBe(true);
    });
});

describe("a plugin widget's declared events", () => {
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

    function allowedHeads(owner: BlueprintOwnerRef, widgetElementType?: string): Set<string> {
        const context = buildBlueprintGraphContext({
            graphKind: "event",
            owner,
            widgetElementType,
            widgetBlueprintEvents: widgetElementType ? widgetModuleRegistry.get(widgetElementType)?.logicApi?.events : undefined,
        });
        return new Set(
            blueprintNodeRegistry.list()
                .filter(def => def.role === "eventHead" && isBlueprintNodeAllowedInGraphContext(def, context))
                .map(def => def.type),
        );
    }

    it("are what the widget's logic API is, and nothing is once the plugin is gone", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        register({ type: RATING, logicApi: RATING_LOGIC });

        expect(getWidgetLogicApi(RATING)?.supportsPrivateBlueprint).toBe(true);
        // Its own two, then the ambient events the host raises on every widget with a blueprint (see
        // `pluginWidgetHeadsAndSlots.test.ts`).
        expect(getWidgetLogicApi(RATING)?.events.map(eventDef => eventDef.id)).toEqual([
            "rated",
            "mouseClick",
            "keyDown",
            "keyUp",
            "onAnyBroadcast",
            "onBroadcast",
            "windowFullscreenChanged",
            "windowFocusChanged",
        ]);
        expect(isBlueprintEventDispatchHeadType(RATED_HEAD)).toBe(true);

        widgetModuleRegistry.unregister(RATING);
        expect(getWidgetLogicApi(RATING)).toBeUndefined();
        expect(isBlueprintEventDispatchHeadType(RATED_HEAD)).toBe(false);
    });

    it("lose a head the plugin does not own, and an event left with none, and say so", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        register({ type: RATING, logicApi: RATING_LOGIC });

        const warned = warn.mock.calls.map(call => String(call[0]));
        expect(warned.some(line => line.includes('"stolen"') && line.includes("blueprint.sound.play"))).toBe(true);
        expect(warned.some(line => line.includes('"headless"'))).toBe(true);
        // A name the plugin picked must not make a node Studio defines a head.
        expect(isBlueprintEventDispatchHeadType("blueprint.sound.play")).toBe(false);
    });

    it("start in the widget's own blueprint on the heads it names, built-in or its own", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        register({ type: RATING, logicApi: RATING_LOGIC });
        const own = allowedHeads({ kind: "widgetMain", surfaceId: "page", elementId: "rating" }, RATING);

        expect(own.has(RATED_HEAD)).toBe(true);
        expect(own.has(MOUSE_CLICK_HEAD)).toBe(true);
        // A head it did not name is not offered, as for a built-in widget.
        expect(own.has("blueprint.event.head.sliderValueChanged")).toBe(false);
    });

    it("are reachable from the properties panel, through the tab a built-in widget's blueprint is in", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        register({
            type: RATING,
            logicApi: RATING_LOGIC,
            createInspector: () => ({ id: "rating", fields: [{ id: "rating.max", type: "number", label: "Max" }] }) as never,
        });
        register({ type: BOX, acceptsChildren: true });
        const rating = element("rating", RATING, "root");

        const schema = widgetModuleRegistry.get(RATING)!.createInspector!({ element: rating, documentService: {} as never });
        expect(schema?.tabs?.map(tab => tab.id)).toEqual(["properties", "interaction"]);
        // The plugin's own fields stay where it put them, on the first tab.
        expect(schema?.tabs?.[0].fields.map(field => field.id)).toEqual(["rating.max"]);
        expect(schema?.tabs?.[1].fields.map(field => field.id)).toEqual(["interaction.blueprint.readonly"]);
        // A widget with no blueprint gets no tab, and no inspector it did not ask for.
        expect(widgetModuleRegistry.get(BOX)!.createInspector).toBeUndefined();
    });

    it("keep the plugin's own head out of blueprints that could never start it", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        register({ type: RATING, logicApi: RATING_LOGIC });
        register({ type: BOX, acceptsChildren: true });

        expect(allowedHeads({ kind: "surfaceMain", surfaceId: "page" }).has(RATED_HEAD)).toBe(false);
        expect(allowedHeads({ kind: "widgetMain", surfaceId: "page", elementId: "box" }, BOX).has(RATED_HEAD)).toBe(false);
        expect(allowedHeads({ kind: "widgetMain", surfaceId: "page", elementId: "label" }, "nl.text").has(RATED_HEAD)).toBe(false);
    });
});
