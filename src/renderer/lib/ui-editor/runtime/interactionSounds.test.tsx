// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { uiInteractionSoundPatch } from "@shared/types/ui-editor/interactionSounds";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import type { DevModeBundle } from "@shared/types/devMode";
import { createDevModeBlueprintHostApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { WidgetRuntimeScopeProvider, WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { EditorNodeWrapper } from "@/lib/ui-editor/runtime/EditorNodeWrapper";
import { setRuntimeLocaleSource } from "@/lib/ui-editor/runtime/localization/runtimeLocale";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { listUIElementAssetIds } from "@/lib/workspace/services/references/referenceModel";
import { createDevModeBlueprintHostAdapter } from "./hostAdapters/devModeBlueprintHostAdapter";
import { collectSurfaceWarmupAssetIds } from "./surfaceAssetWarmup";

afterEach(() => {
    cleanup();
});

type ElementSpec = {
    id: string;
    type: string;
    parentId: string | null;
    childrenIds?: string[];
    hover?: string;
    click?: string;
    extra?: Record<string, unknown>;
};

function elementOf(spec: ElementSpec): UIElement {
    return {
        id: spec.id,
        type: spec.type,
        parentId: spec.parentId,
        childrenIds: spec.childrenIds ?? [],
        layout: { x: 0, y: 0, width: 120, height: 80 },
        props: {
            ...(spec.hover ? uiInteractionSoundPatch("hover", spec.hover) : {}),
            ...(spec.click ? uiInteractionSoundPatch("click", spec.click) : {}),
        },
        ...(spec.extra ? { extra: spec.extra } : {}),
    };
}

/**
 * A page of the given elements, with no blueprints at all, whose host API records every clip it is
 * asked to play. No graph is needed: a sound is the element's own, and plays whether or not anything
 * listens for the click.
 */
function createClickFixture(specs: ElementSpec[], components: { id: string; rootElementId: string; elements: ElementSpec[] }[] = []) {
    const elements: Record<string, UIElement> = {
        root: elementOf({ id: "root", type: "nl.root", parentId: null, childrenIds: specs.filter(s => s.parentId === "root").map(s => s.id) }),
    };
    for (const spec of specs) {
        elements[spec.id] = elementOf(spec);
    }
    const document: UIDocument = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "player",
                kind: "stageSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
                mount: { kind: "slot", slotId: "onStage" },
            },
        ],
        elements,
        components: components.map(component => ({
            id: component.id,
            name: component.id,
            rootElementId: component.rootElementId,
            elements: Object.fromEntries(component.elements.map(spec => [spec.id, elementOf(spec)])),
        })),
    };
    const blueprintDocument: BlueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {},
        ownerRecords: {},
    };
    const bundle: DevModeBundle = {
        bundleId: "bundle",
        revision: 1,
        timestamp: "2026-10-02T00:00:00.000Z",
        ui: {
            uidoc: document,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
            localBlueprints: blueprintDocument,
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    };
    const played: string[] = [];
    const scope = new ScopeStoreBridge();
    const debug = new DebugBridge();
    const hostApi = createDevModeBlueprintHostApi({
        document,
        scope,
        activeSurfaceId: "surface",
        emit: event => debug.emit(event),
        onOpenSurface: () => undefined,
        onPageBack: () => undefined,
        onWidgetPatch: () => undefined,
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
        onPlaySound: input => {
            played.push(input.assetId);
            return null;
        },
    });
    const adapter = createDevModeBlueprintHostAdapter({
        bundle,
        surface: document.surfaces[0] as UISurface,
        scopeBridge: scope,
        debug,
        hostApi,
    });
    return { adapter, played, document };
}

describe("click sounds", () => {
    it("plays the clicked element's own sound", async () => {
        const { adapter, played } = createClickFixture([
            { id: "start", type: "nl.button", parentId: "root", click: "confirm" },
        ]);

        await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("start", "mouseClick", { x: 1, y: 1 });

        expect(played).toEqual(["confirm"]);
    });

    it("plays the nearest ancestor's sound for a press on something inside it", async () => {
        // The card built from a container with a label on it: the label is what the pointer lands on.
        const { adapter, played } = createClickFixture([
            { id: "card", type: "nl.container", parentId: "root", childrenIds: ["label"], click: "card-sound" },
            { id: "label", type: "nl.text", parentId: "card" },
        ]);

        await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("label", "mouseClick", { x: 1, y: 1 });

        expect(played).toEqual(["card-sound"]);
    });

    it("plays only the innermost sound when sounding elements are nested", async () => {
        const { adapter, played } = createClickFixture([
            { id: "card", type: "nl.container", parentId: "root", childrenIds: ["delete"], click: "card-sound" },
            { id: "delete", type: "nl.button", parentId: "card", click: "back" },
        ]);

        await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("delete", "mouseClick", { x: 1, y: 1 });

        expect(played).toEqual(["back"]);
    });

    it("plays nothing for a gesture that is not a click", async () => {
        const { adapter, played } = createClickFixture([
            { id: "start", type: "nl.button", parentId: "root", click: "confirm" },
        ]);

        await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("start", "mouseDown", { x: 1, y: 1 });
        await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("start", "mouseEnter", { x: 1, y: 1 });
        await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("start", "mouseWheel", { x: 1, y: 1 });

        expect(played).toEqual([]);
    });

    it("takes a component's sound from its definition, and leaves it for the placement's", async () => {
        const { adapter, played } = createClickFixture(
            [
                { id: "menu", type: "nl.container", parentId: "root", childrenIds: ["slot"], click: "menu-sound" },
                {
                    id: "slot",
                    type: "nl.container",
                    parentId: "menu",
                    extra: { componentLink: { componentId: "save-slot", linked: true } },
                },
            ],
            [
                {
                    id: "save-slot",
                    rootElementId: "hit",
                    elements: [
                        { id: "hit", type: "nl.container", parentId: null, childrenIds: ["title"], click: "slot-sound" },
                        { id: "title", type: "nl.text", parentId: "hit" },
                    ],
                },
                {
                    id: "plain",
                    rootElementId: "plain-root",
                    elements: [{ id: "plain-root", type: "nl.container", parentId: null }],
                },
            ],
        );

        await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("title", "mouseClick", { x: 1, y: 1 }, {
            componentId: "save-slot",
            instanceKey: buildUIComponentInstanceKey(undefined, "slot"),
        });
        expect(played).toEqual(["slot-sound"]);

        // A definition with no sound of its own: the press goes on past the placement to the page.
        played.length = 0;
        await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("plain-root", "mouseClick", { x: 1, y: 1 }, {
            componentId: "plain",
            instanceKey: buildUIComponentInstanceKey(undefined, "slot"),
        });
        expect(played).toEqual(["menu-sound"]);
    });

    it("lets a list's sound answer a press on any of its rows", async () => {
        const { adapter, played } = createClickFixture([
            { id: "saves", type: "nl.list", parentId: "root", childrenIds: ["row"], click: "list-sound" },
            { id: "row", type: "nl.container", parentId: "saves" },
        ]);

        await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("row", "mouseClick", { x: 1, y: 1 }, {
            listItemScope: { listElementId: "saves", itemKey: "slot-3", index: 2, item: {} } as never,
            instanceKey: buildUIListItemInstanceKey(undefined, "saves", "slot-3"),
        });

        expect(played).toEqual(["list-sound"]);
    });

    it("answers an asset set in the player's language", async () => {
        const { adapter, played, document } = createClickFixture([
            { id: "start", type: "nl.button", parentId: "root", click: "set-confirm" },
        ]);
        document.elements.start!.assetVariants = { "set-confirm": { en: "confirm-en", ja: "confirm-ja" } };
        const uninstall = setRuntimeLocaleSource({ getLocale: () => "ja", sourceLocale: "en" });
        try {
            await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("start", "mouseClick", { x: 1, y: 1 });
        } finally {
            uninstall();
        }

        expect(played).toEqual(["confirm-ja"]);
    });
});

describe("hover sounds", () => {
    function renderNested(options: { cardHover?: string; buttonHover?: string; buttonDisabled?: boolean; hostApi?: boolean }) {
        const play = vi.fn(async () => null);
        const hostAdapter: UIHostAdapter = {
            host: "player",
            blueprintRuntime: {
                surfaceId: "surface",
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async () => undefined,
                ...(options.hostApi === false ? {} : { hostApi: { sound: { play } } as never }),
            },
        };
        const card = elementOf({ id: "card", type: "nl.container", parentId: "root", childrenIds: ["button"], hover: options.cardHover });
        const button = elementOf({ id: "button", type: "nl.button", parentId: "card", hover: options.buttonHover });
        if (options.buttonDisabled) {
            button.props = { ...button.props, interactionDisabled: true };
        }
        const view = render(
            <WidgetRuntimeStateProvider externalStore={new WidgetRuntimeStateStore()}>
                <WidgetRuntimeScopeProvider runtimeScopeId="scope">
                    <EditorNodeWrapper element={card} layout={card.layout} hostAdapter={hostAdapter} interactive>
                        <EditorNodeWrapper element={button} layout={button.layout} hostAdapter={hostAdapter} interactive />
                    </EditorNodeWrapper>
                </WidgetRuntimeScopeProvider>
            </WidgetRuntimeStateProvider>,
        );
        const node = (id: string) => {
            const found = view.container.querySelector(`[data-ui-element-id="${id}"]`);
            if (!found) {
                throw new Error(`no node for ${id}`);
            }
            return found;
        };
        const playedIds = () => play.mock.calls.map(call => (call as unknown as [{ assetId: string }])[0].assetId);
        return { node, play, playedIds };
    }

    /** Move a pointer of the given kind from outside the card straight onto `target`. */
    async function enter(target: Element, pointerType = "mouse") {
        await act(async () => {
            fireEvent.pointerOver(target, { relatedTarget: document.body, pointerType });
        });
    }

    it("plays the entered element's hover sound", async () => {
        const { node, playedIds } = renderNested({ cardHover: "card-hover" });

        await enter(node("card"));

        expect(playedIds()).toEqual(["card-hover"]);
    });

    it("plays only the innermost when the pointer enters nested sounding elements at once", async () => {
        const { node, playedIds } = renderNested({ cardHover: "card-hover", buttonHover: "button-hover" });

        await enter(node("button"));

        expect(playedIds()).toEqual(["button-hover"]);
    });

    it("lets a card sound for a pointer arriving on a child that has none", async () => {
        const { node, playedIds } = renderNested({ cardHover: "card-hover" });

        await enter(node("button"));

        expect(playedIds()).toEqual(["card-hover"]);
    });

    it("stays silent while the element is disabled", async () => {
        const { node, playedIds } = renderNested({ buttonHover: "button-hover", buttonDisabled: true });

        await enter(node("button"));

        expect(playedIds()).toEqual([]);
    });

    it("plays nothing for a touch, which has no hover", async () => {
        const { node, playedIds } = renderNested({ buttonHover: "button-hover" });

        await enter(node("button"), "touch");

        expect(playedIds()).toEqual([]);
    });

    it("plays nothing where there is no running game to play it", async () => {
        const { node, play } = renderNested({ buttonHover: "button-hover", hostApi: false });

        await enter(node("button"));

        expect(play).not.toHaveBeenCalled();
    });
});

/**
 * Each of these is a reader that finds library ids by property name. A sound one of them missed
 * would ship missing from the package, arrive late on the first hover, or be deleted from the
 * library while a button still played it.
 */
describe("the asset readers", () => {
    it("see both sounds as uses of their files", () => {
        const { document } = createClickFixture([
            { id: "start", type: "nl.button", parentId: "root", hover: "hover-file", click: "click-file" },
        ]);

        expect(listUIElementAssetIds(document.elements.start!).sort()).toEqual(["click-file", "hover-file"]);
        expect(
            collectSurfaceWarmupAssetIds({ uidoc: document, fontAssetIds: [], manifestIds: null }, "surface").sort(),
        ).toEqual(["click-file", "hover-file"]);
    });
});
