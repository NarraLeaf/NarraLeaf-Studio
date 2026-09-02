import { afterEach, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import {
    countBlueprintBroadcastListeners,
    dispatchBlueprintBroadcastEvent,
    dispatchBlueprintElementClickEvent,
    dispatchWidgetsBlueprintEvent,
} from "./BlueprintDispatcher";
import { DebugBridge } from "./DebugBridge";
import { mountCompiledScripts, unmountCompiledScripts } from "./script/scriptRuntime";
import {
    surfaceMainOwnerKey,
    widgetMainOwnerKey,
} from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";

/**
 * The three fan-out dispatches, and whether a script hears them.
 *
 * Each of these walks a surface asking every blueprint on it "do you listen for this", and each one
 * used to ask that question of graphs only - `program.kind !== "graph"` and skip. A script on a
 * button therefore never received a broadcast, never received a click aimed at another element, and
 * never received an ambient event, while `.d.ts` offered the author all three handlers. These are
 * the behavioural half of `script/scriptEventDispatch.test.ts`: that one asserts the names line up,
 * this one asserts the dispatch arrives.
 */

const SURFACE_ID = "surface-1";
const BUTTON_ID = "el-button";

function uiDocument(): UIDocument {
    return {
        surfaces: [{ id: SURFACE_ID, name: "Title", kind: "page", rootElementId: "el-root" }],
        elements: {
            "el-root": { id: "el-root", type: "nl.container", childrenIds: [BUTTON_ID] },
            [BUTTON_ID]: { id: BUTTON_ID, type: "nl.button", childrenIds: [] },
        },
    } as unknown as UIDocument;
}

function scriptBlueprint(id: string, owner: Blueprint["owner"]): Blueprint {
    return {
        id,
        name: id,
        owner,
        frontend: "typescript",
        programKind: "scriptModule",
        program: { kind: "scriptModule", scriptRef: `scripts/${id}.ts` },
        members: { variables: {}, fields: {}, functions: {} },
        bindings: {},
    } as unknown as Blueprint;
}

/** A document whose button carries a script blueprint, and whose page carries one too. */
function blueprintDocument(): BlueprintDocument {
    const widget = scriptBlueprint("bp-widget", {
        kind: "widgetMain",
        surfaceId: SURFACE_ID,
        elementId: BUTTON_ID,
    });
    const surface = scriptBlueprint("bp-surface", { kind: "surfaceMain", surfaceId: SURFACE_ID });
    return {
        blueprints: { "bp-widget": widget, "bp-surface": surface },
        ownerRecords: {
            // Spelled through the helpers, never by hand: the key format is one function's business
            // and a fixture that restates it stops testing the thing that produces it.
            [widgetMainOwnerKey(SURFACE_ID, BUTTON_ID)]: {
                privateBlueprintIds: ["bp-widget"],
                activeBlueprintId: "bp-widget",
            },
            [surfaceMainOwnerKey(SURFACE_ID)]: {
                privateBlueprintIds: ["bp-surface"],
                activeBlueprintId: "bp-surface",
            },
        },
    } as unknown as BlueprintDocument;
}

/**
 * The smallest host a script context can be built from.
 *
 * `hostApi` has to be present or the context builder refuses (a host without one is the editor
 * preview, which does not dispatch); nothing in these tests calls through it.
 */
function hostAdapter(): UIHostAdapter {
    return { blueprintRuntime: { hostApi: {} } } as unknown as UIHostAdapter;
}

async function mount(modules: Record<string, Record<string, unknown>>): Promise<void> {
    const scripts = Object.fromEntries(
        Object.keys(modules).map(blueprintId => [
            blueprintId,
            { scriptRef: `scripts/${blueprintId}.ts`, url: `file:///${blueprintId}.mjs` },
        ]),
    );
    await mountCompiledScripts(scripts, undefined, async url => {
        const id = url.replace("file:///", "").replace(".mjs", "");
        return modules[id] ?? {};
    });
}

function dispatchOptions() {
    return {
        document: uiDocument(),
        blueprintDocument: blueprintDocument(),
        persistentVariables: {} as never,
        surfaceId: SURFACE_ID,
        hostAdapter: hostAdapter(),
        debug: new DebugBridge(),
        getSurfaceState: () => undefined,
        setSurfaceState: () => undefined,
    };
}

afterEach(() => {
    unmountCompiledScripts();
});

describe("a broadcast reaches a script", () => {
    it("calls onBroadcast on the page and on a widget, with the event name in the payload", async () => {
        const seen: string[] = [];
        await mount({
            "bp-widget": { onBroadcast: (_ctx: unknown, event: { event: string }) => seen.push(`widget:${event.event}`) },
            "bp-surface": { onBroadcast: (_ctx: unknown, event: { event: string }) => seen.push(`surface:${event.event}`) },
        });

        await dispatchBlueprintBroadcastEvent({
            ...dispatchOptions(),
            eventName: "openMenu",
            data: null,
        });

        // The page first, then the elements in document order - the same order a graph fan-out uses.
        expect(seen).toEqual(["surface:openMenu", "widget:openMenu"]);
    });

    it("counts a script as a listener, so ctx.broadcast.listenerCount() can see it", async () => {
        await mount({ "bp-widget": { onBroadcast: () => undefined } });
        expect(
            countBlueprintBroadcastListeners({
                document: uiDocument(),
                blueprintDocument: blueprintDocument(),
                surfaceId: SURFACE_ID,
                eventName: "openMenu",
            }),
        ).toBe(1);
    });

    it("counts nothing when no script exports the handler", async () => {
        await mount({ "bp-widget": { onInit: () => undefined } });
        expect(
            countBlueprintBroadcastListeners({
                document: uiDocument(),
                blueprintDocument: blueprintDocument(),
                surfaceId: SURFACE_ID,
                eventName: "openMenu",
            }),
        ).toBe(0);
    });
});

describe("an element event reaches a script", () => {
    it("calls onElementClick and reports the click as handled", async () => {
        const seen: unknown[] = [];
        await mount({
            "bp-surface": { onElementClick: (_ctx: unknown, event: unknown) => seen.push(event) },
        });

        const handled = await dispatchBlueprintElementClickEvent({
            ...dispatchOptions(),
            target: { surfaceId: SURFACE_ID, elementId: BUTTON_ID, elementType: "nl.button" },
            eventPayload: { x: 4, y: 2, button: 0 },
        });

        expect(handled).toBe(true);
        // The payload names the element that was clicked; the filter a graph head carries in a field
        // is the author's own `if` here.
        expect(seen).toEqual([{ x: 4, y: 2, button: 0, element: { surfaceId: SURFACE_ID, elementId: BUTTON_ID, elementType: "nl.button" } }]);
    });

    it("is not handled when nothing exports the handler", async () => {
        await mount({ "bp-surface": { onInit: () => undefined } });
        const handled = await dispatchBlueprintElementClickEvent({
            ...dispatchOptions(),
            target: { surfaceId: SURFACE_ID, elementId: BUTTON_ID, elementType: "nl.button" },
        });
        expect(handled).toBe(false);
    });
});

describe("an ambient widget event reaches a script", () => {
    it("calls the handler the head names, not the one the slot is called", async () => {
        const seen: unknown[] = [];
        await mount({
            // The slot is `windowFullscreenChanged`; the head - and so the export - is
            // `fullscreenChanged`. Asking for `onWindowFullscreenChanged` is what used to happen.
            "bp-widget": { onFullscreenChanged: (_ctx: unknown, event: unknown) => seen.push(event) },
        });

        await dispatchWidgetsBlueprintEvent({
            ...dispatchOptions(),
            eventName: "windowFullscreenChanged",
            eventPayload: { isFullscreen: true },
        });

        expect(seen).toEqual([{ isFullscreen: true }]);
    });
});
