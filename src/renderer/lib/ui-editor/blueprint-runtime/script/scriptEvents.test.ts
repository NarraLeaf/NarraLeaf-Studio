import { describe, expect, it } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
} from "@shared/types/blueprint/graph";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { blueprintNodeRegistry, isBlueprintNodeAllowedInGraphContext } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { buildBlueprintGraphContext } from "@/lib/ui-editor/blueprint-nodes/graphContext";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import type { BlueprintNodeDef } from "@/lib/ui-editor/blueprint-nodes/types";
import { SCRIPT_WIDGET_TYPES, type ScriptWidgetType } from "./scriptContext";
import {
    COMPONENT_EXCLUDED_EVENTS,
    SCRIPT_EVENT_HEADS,
    SCRIPT_EVENT_PAYLOADS,
    SCRIPT_EVENTS_BY_ANCHOR,
    SCRIPT_EVENTS_BY_WIDGET,
    scriptEventExportName,
    type ComponentWidgetCtx,
    type ComponentWidgetScriptModule,
    type GlobalCtx,
    type GlobalHandler,
    type GlobalScriptModule,
    type ScriptEvent,
    type ScriptEventId,
    type ScriptModuleFor,
    type ScriptPinKind,
    type StoryScriptModule,
    type SurfaceCtx,
    type SurfaceScriptModule,
    type ValueScriptModule,
    type WidgetHandler,
    type WidgetScriptModule,
} from "./scriptEvents";

/**
 * The script export tables are held to the node catalogue.
 *
 * Heads, their pins and the palette's answer for each slot are all stated once, in the registry;
 * `scriptEvents.ts` restates them in the shape a module needs, and this file is what stops the
 * restatement drifting. A head added without an event, a pin renamed without its payload field, a
 * scope widened without its export list - each fails here by name.
 */

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/** Every owner position has a module shape; a new one is a compile error until it does. */
type OwnersWithoutAModule = {
    [K in BlueprintOwnerRef["kind"]]: [ScriptModuleFor<Extract<BlueprintOwnerRef, { kind: K }>>] extends [never] ? K : never;
}[BlueprintOwnerRef["kind"]];

type ModuleChecks = [
    Expect<Equal<OwnersWithoutAModule, never>>,
    Expect<Equal<ScriptModuleFor<{ kind: "storyAction"; blueprintId: string }>, StoryScriptModule<"action">>>,
    Expect<Equal<ScriptModuleFor<{ kind: "storyAction"; blueprintId: string; mode: "condition" }>, StoryScriptModule<"condition">>>,
];

const moduleChecks: ModuleChecks | null = null;

// ---------------------------------------------------------------------------
// What an author may write, and what they may not
// ---------------------------------------------------------------------------

/**
 * A project script, written the way an author writes one: named exports, each annotated.
 *
 * The handlers are declared here and gathered into the module type below, which is what a real
 * module's namespace is. Both annotation forms appear because both are offered - a function
 * declaration naming `ctx` and `event`, and a `const` naming the whole handler.
 */
async function onAppBoot(ctx: GlobalCtx): Promise<void> {
    await ctx.host.navigation.openSurface("title");
    const noBroadcast: undefined = ctx.broadcast;
    void noBroadcast;
}

const onGlobalKeyDown: GlobalHandler<"keyDown"> = (ctx, event) => {
    // The filter a graph puts on the card is a line of the author's code: one export, not two.
    if (event.key === "Escape" && !event.ctrlKey) {
        ctx.stopPropagation();
    }
};

const globalModule: GlobalScriptModule = { onAppBoot, onKeyDown: onGlobalKeyDown };

// @ts-expect-error a project script has nothing to click
const globalHearsClicks: GlobalScriptModule = { onMouseClick() {} };

async function onAction(ctx: SurfaceCtx, event: ScriptEvent<"action">): Promise<void> {
    if (event.actionId === "advance" && event.source === "touch") {
        await ctx.broadcast.send("advance", { x: event.x, y: event.y });
    }
}

function onElementClick(ctx: SurfaceCtx, event: ScriptEvent<"elementClick">): void {
    void ctx.surface.isTransitioning();
    void event.element.elementId;
}

const surfaceModule: SurfaceScriptModule = { onAction, onElementClick };

const onSliderValueChanged: WidgetHandler<"nl.slider", "sliderValueChanged"> = async (ctx, event) => {
    ctx.vars.previous = event.previousValue;
    await ctx.host.widget.setTextProperties("value-label", { text: String(event.value) });
    if (ctx.self.row) {
        void ctx.self.row.index;
    }
};

const sliderModule: WidgetScriptModule<"nl.slider"> = { onSliderValueChanged };

// @ts-expect-error a slider has no switch events
const sliderHearsSwitch: WidgetScriptModule<"nl.slider"> = { onSwitchChanged() {} };

// @ts-expect-error and naming one in an annotation is refused at the annotation
const sliderSwitchHandler: WidgetHandler<"nl.slider", "switchChanged"> = () => {};

function onComponentMouseClick(ctx: ComponentWidgetCtx<"nl.button">): void {
    const slot: string | undefined = ctx.self.params.slot;
    void slot;
}

const componentModule: ComponentWidgetScriptModule<"nl.button"> = { onMouseClick: onComponentMouseClick };

// @ts-expect-error a component definition's script does not hear the keyboard
const componentHearsKeys: ComponentWidgetScriptModule<"nl.button"> = { onKeyDown() {} };

const valueModule: ValueScriptModule = { default: ctx => ctx.host.game.getPlaytime() };

// @ts-expect-error a value script cannot wait
const valueWaits: ValueScriptModule = { default: async ctx => ctx.host.game.getPlaytime() };

const valueWrites: ValueScriptModule = {
    default: ctx => {
        // @ts-expect-error a value script cannot write
        void ctx.host.widget.setVisible("x", true);
        return 0;
    },
};

const storyAction: StoryScriptModule = {
    default: async ctx => {
        await ctx.persistent.set("seen-intro", true);
        ctx.saved.set("gold", 1);
    },
};

const storyReachesHost: StoryScriptModule = {
    default: ctx => {
        // @ts-expect-error a story row has no host API
        void ctx.host;
    },
};

const storyValue: StoryScriptModule<"value"> = { default: ctx => String(ctx.scene.get("name")) };

// @ts-expect-error a story value is rendered in the same tick and cannot wait
const storyValueWaits: StoryScriptModule<"value"> = { default: async ctx => String(ctx.scene.get("name")) };

const storyValueReachesPersistence: StoryScriptModule<"value"> = {
    default: ctx => {
        // @ts-expect-error the synchronous modes have no persistence
        void ctx.persistent;
        return 1;
    },
};

const storyCondition: StoryScriptModule<"condition"> = { default: ctx => ctx.saved.get("gold") === 1 };

// @ts-expect-error a condition answers a boolean
const storyConditionAnswersText: StoryScriptModule<"condition"> = { default: () => "yes" };

const authored = [
    globalModule,
    globalHearsClicks,
    surfaceModule,
    sliderModule,
    sliderHearsSwitch,
    sliderSwitchHandler,
    componentModule,
    componentHearsKeys,
    valueModule,
    valueWaits,
    valueWrites,
    storyAction,
    storyReachesHost,
    storyValue,
    storyValueWaits,
    storyValueReachesPersistence,
    storyCondition,
    storyConditionAnswersText,
];

// ---------------------------------------------------------------------------
// Held to the registry
// ---------------------------------------------------------------------------

/**
 * Which head's pins a folded event's payload is checked against: the unfiltered twin.
 */
const PAYLOAD_SOURCE_HEAD: Partial<Record<ScriptEventId, string>> = {
    keyDown: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    keyUp: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
    preferenceChanged: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED,
    broadcast: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
};

/** Card fields that join the payload because the filter they expressed is now the author's code. */
const FOLDED_FIELDS: Partial<Record<ScriptEventId, readonly string[]>> = {
    action: ["actionId"],
};

/** Which script kinds may stand for a pin's graph type. */
const PIN_KINDS_FOR_VALUE_TYPE: Record<string, readonly ScriptPinKind[]> = {
    float: ["number"],
    integer: ["number"],
    string: ["string", "preferenceKey"],
    boolean: ["boolean"],
    json: ["unknown", "preferenceValue"],
    any: ["unknown"],
    element: ["element"],
};

function eventHeads(): BlueprintNodeDef[] {
    registerCoreBlueprintNodes();
    return blueprintNodeRegistry.list().filter(def => def.role === "eventHead" || def.role === "elementEventHead");
}

function unique<T>(values: readonly T[]): T[] {
    return [...new Set(values)].sort();
}

function widgetEvents(widgetType: string) {
    return getWidgetLogicApi(widgetType)?.events.map(event => ({ id: event.id, headNodeTypes: event.headNodeTypes }));
}

/** The events a script on this owner may export, as the palette would answer it head by head. */
function eventsThePaletteOffers(owner: BlueprintOwnerRef, widgetType?: ScriptWidgetType): ScriptEventId[] {
    const ctx = buildBlueprintGraphContext({
        graphKind: "event",
        owner,
        widgetElementType: widgetType,
        widgetBlueprintEvents: widgetType ? widgetEvents(widgetType) : undefined,
        widgetEventLayerSlots: widgetType ? [] : undefined,
        isComponentDefinitionGraph: owner.kind === "componentWidgetMain",
    });
    return unique(
        eventHeads()
            .filter(def => def.type !== BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL && isBlueprintNodeAllowedInGraphContext(def, ctx))
            .map(def => SCRIPT_EVENT_HEADS[def.type]),
    );
}

describe("script events are held to the node catalogue", () => {
    it("compiles the module shapes and the authored samples", () => {
        expect(moduleChecks).toBeNull();
        expect(authored).toHaveLength(18);
    });

    it("maps every registered head to an event, and On Call alone to none", () => {
        const heads = eventHeads().map(def => def.type).sort();
        expect(heads.length).toBeGreaterThan(40);
        const unmapped = heads.filter(type => !(type in SCRIPT_EVENT_HEADS));
        expect(unmapped).toEqual([BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL]);
        const unregistered = Object.keys(SCRIPT_EVENT_HEADS).filter(type => !heads.includes(type));
        expect(unregistered).toEqual([]);
    });

    it("gives every event a payload, and every payload an event", () => {
        expect(unique(Object.values(SCRIPT_EVENT_HEADS))).toEqual(unique(Object.keys(SCRIPT_EVENT_PAYLOADS) as ScriptEventId[]));
    });

    it("shapes each payload from the head's data output pins", () => {
        const byType = new Map(eventHeads().map(def => [def.type, def]));
        const headsByEvent = new Map<ScriptEventId, string[]>();
        for (const [type, event] of Object.entries(SCRIPT_EVENT_HEADS)) {
            headsByEvent.set(event, [...(headsByEvent.get(event) ?? []), type]);
        }
        for (const [event, fields] of Object.entries(SCRIPT_EVENT_PAYLOADS) as [ScriptEventId, Record<string, ScriptPinKind>][]) {
            const heads = headsByEvent.get(event) ?? [];
            const source = PAYLOAD_SOURCE_HEAD[event] ?? (heads.length === 1 ? heads[0] : undefined);
            expect(source, `${event} folds several heads and names no payload source`).toBeDefined();
            const def = byType.get(source!)!;
            const pins = def.pins.filter(pin => pin.kind === "output" && pin.semantic === "data");
            const expectedFields = unique([...pins.map(pin => pin.id), ...(FOLDED_FIELDS[event] ?? [])]);
            // Failing here means a head's pins and its event's payload disagree. The pins are the
            // catalogue's word; change the payload.
            expect(unique(Object.keys(fields)), event).toEqual(expectedFields);
            for (const pin of pins) {
                const allowed = PIN_KINDS_FOR_VALUE_TYPE[pin.valueType ?? "any"];
                expect(allowed, `${event}.${pin.id} has pin type ${pin.valueType}, which no script kind stands for`).toBeDefined();
                expect(allowed, `${event}.${pin.id}`).toContain(fields[pin.id]);
            }
        }
    });

    it("names exports by the rule", () => {
        expect(scriptEventExportName("mouseClick")).toBe("onMouseClick");
        expect(scriptEventExportName("init")).toBe("onInit");
    });

    it("offers a project script what the palette offers a global blueprint", () => {
        expect(unique(SCRIPT_EVENTS_BY_ANCHOR.project)).toEqual(eventsThePaletteOffers({ kind: "globalMain" }));
    });

    it("offers a surface script what the palette offers a surface blueprint", () => {
        expect(unique(SCRIPT_EVENTS_BY_ANCHOR.surface)).toEqual(
            eventsThePaletteOffers({ kind: "surfaceMain", surfaceId: "surface" }),
        );
    });

    it.each(SCRIPT_WIDGET_TYPES)("offers a %s script what the palette offers its widget blueprint", widgetType => {
        expect(unique(SCRIPT_EVENTS_BY_WIDGET[widgetType])).toEqual(
            eventsThePaletteOffers({ kind: "widgetMain", surfaceId: "surface", elementId: "element" }, widgetType),
        );
    });

    it.each(SCRIPT_WIDGET_TYPES)("offers a %s script inside a component what the palette offers there", widgetType => {
        const excluded = new Set<ScriptEventId>(COMPONENT_EXCLUDED_EVENTS);
        expect(unique(SCRIPT_EVENTS_BY_WIDGET[widgetType].filter(event => !excluded.has(event)))).toEqual(
            eventsThePaletteOffers({ kind: "componentWidgetMain", componentId: "component", elementId: "element" }, widgetType),
        );
    });
});
