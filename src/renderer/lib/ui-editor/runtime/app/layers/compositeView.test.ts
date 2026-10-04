import { describe, expect, it } from "vitest";
import type { UIAppSurface, UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";
import { LayerStackController } from "./LayerStackController";
import { resolveCompositeInput } from "./compositeInput";
import { buildCompositeView, listStageSurfaces, type CompositeViewInput } from "./compositeView";

const SURFACE_NAMES: Record<string, string> = {
    menu: "Main Menu",
    confirm: "Quit Confirm",
    settings: "Settings",
};

function stageSurface(id: string, slotId: UIStageSlotId): UIStageSurface {
    return {
        id,
        name: `${id} surface`,
        host: "player",
        kind: "stageSurface",
        designSize: { width: 1920, height: 1080 },
        rootElementId: `${id}-root`,
        mount: { kind: "slot", slotId },
    };
}

function appSurface(id: string): UIAppSurface {
    return {
        id,
        name: `${id} page`,
        host: "app",
        kind: "appSurface",
        designSize: { width: 1920, height: 1080 },
        rootElementId: `${id}-root`,
    };
}

function describeStack(input: {
    controller: LayerStackController;
    pageStack?: CompositeViewInput["pageStack"];
    renderedLayerKeys?: readonly string[];
    keyboardLane?: CompositeViewInput["keyboardLane"];
    gameHiddenKeys?: readonly string[];
    stage?: CompositeViewInput["stage"];
}) {
    const snapshot = input.controller.getSnapshot();
    const pageStack = input.pageStack ?? [{ key: "menu:1", surfaceId: "menu" }];
    const top = pageStack[pageStack.length - 1] ?? null;
    // Everything the host can render unless the caller says otherwise.
    const rendered = new Set(input.renderedLayerKeys ?? snapshot.layers.map(layer => layer.key));
    const onScreenLayers = snapshot.layers.filter(layer => rendered.has(layer.key));
    const resolution = resolveCompositeInput({
        pageEntries: top ? [{ key: top.key }] : [],
        activePageKey: top?.key ?? null,
        layers: onScreenLayers,
    });
    return buildCompositeView({
        pageStack,
        pagesHiddenForGame: input.gameHiddenKeys !== undefined,
        gameHiddenKeys: new Set(input.gameHiddenKeys ?? []),
        layers: snapshot.layers,
        queued: snapshot.queued,
        renderedLayerKeys: rendered,
        resolution,
        keyboardLane: input.keyboardLane !== undefined
            ? input.keyboardLane
            : resolution.keyboardOwnerKey ? { kind: "entry", entry: { key: resolution.keyboardOwnerKey } } : null,
        stage: input.stage ?? null,
        exitPending: snapshot.exitPending,
        surfaceName: surfaceId => SURFACE_NAMES[surfaceId] ?? null,
    });
}

describe("buildCompositeView", () => {
    it("reports the page lane alone when nothing is stacked on it and no game is running", () => {
        const view = describeStack({ controller: new LayerStackController() });
        expect(view.stage).toBeNull();
        expect(view.page).toEqual({
            key: "menu:1",
            surfaceId: "menu",
            surfaceName: "Main Menu",
            interactive: true,
            keyboardOwner: true,
        });
        expect(view.offScreenPages).toEqual([]);
        expect(view.layers).toEqual([]);
        expect(view.queued).toEqual([]);
        expect(view.exitPending).toBe(false);
    });

    it("passes the input arbitration through rather than deciding again", () => {
        const controller = new LayerStackController();
        controller.show({ surfaceId: "confirm", modal: true });
        const view = describeStack({ controller });
        expect(view.page?.interactive).toBe(false);
        expect(view.page?.keyboardOwner).toBe(false);
        expect(view.layers[0]).toMatchObject({ interactive: true, keyboardOwner: true, modal: true });
    });

    it("marks the keyboard from the lane a key reaches, not from the owner key alone", () => {
        // The composite names the page as its owner, but the page is not ready to hear a key, so
        // the listener reaches nothing - and neither may the panel say anything does.
        const view = describeStack({ controller: new LayerStackController(), keyboardLane: null });
        expect(view.page?.keyboardOwner).toBe(false);
    });

    it("lists the pages under the one on screen as off screen", () => {
        const view = describeStack({
            controller: new LayerStackController(),
            pageStack: [{ key: "menu:1", surfaceId: "menu" }, { key: "settings:2", surfaceId: "settings" }],
        });
        expect(view.page?.key).toBe("settings:2");
        expect(view.offScreenPages).toEqual([
            { key: "menu:1", surfaceId: "menu", surfaceName: "Main Menu", hiddenForGame: false },
        ]);
    });

    it("draws no page while a running game hides them, and lists the hidden ones as such", () => {
        const view = describeStack({
            controller: new LayerStackController(),
            gameHiddenKeys: ["menu:1"],
            keyboardLane: { kind: "stage" },
            stage: { storyOnScreen: true, coveredByPage: false, pointerLive: true, dialogHidden: false, surfaces: [] },
        });
        expect(view.page).toBeNull();
        expect(view.offScreenPages).toEqual([
            { key: "menu:1", surfaceId: "menu", surfaceName: "Main Menu", hiddenForGame: true },
        ]);
        expect(view.stage).toEqual({ interactive: true, keyboardOwner: true, gameUi: [] });
    });

    it("lists the Game UI in the order the player stacks it, and fades all but notifications under a page", () => {
        const view = describeStack({
            controller: new LayerStackController(),
            pageStack: [{ key: "menu:1", surfaceId: "menu" }, { key: "settings:3", surfaceId: "settings" }],
            gameHiddenKeys: ["menu:1"],
            stage: {
                storyOnScreen: false,
                coveredByPage: true,
                pointerLive: true,
                dialogHidden: false,
                surfaces: [
                    { runtimeScopeId: "s:notification", surface: stageSurface("toasts", "notification"), takesInput: false },
                    { runtimeScopeId: "s:onStage", surface: stageSurface("quick", "onStage"), takesInput: true },
                    { runtimeScopeId: "s:dialog", surface: stageSurface("box", "dialog"), takesInput: true },
                ],
            },
        });
        expect(view.stage?.gameUi.map(ui => [ui.slotId, ui.concealed, ui.interactive])).toEqual([
            ["dialog", true, false],
            ["onStage", true, false],
            ["notification", false, false],
        ]);
        expect(view.stage).toMatchObject({ interactive: false, keyboardOwner: false });
        expect(view.page).toMatchObject({ key: "settings:3", keyboardOwner: true, interactive: true });
    });

    it("takes clicks from the Game UI under a modal layer over the story, without fading it", () => {
        const controller = new LayerStackController();
        controller.show({ surfaceId: "confirm", modal: true });
        const view = describeStack({
            controller,
            gameHiddenKeys: ["menu:1"],
            stage: {
                storyOnScreen: false,
                coveredByPage: false,
                pointerLive: true,
                dialogHidden: false,
                surfaces: [
                    { runtimeScopeId: "s:dialog", surface: stageSurface("box", "dialog"), takesInput: true },
                    { runtimeScopeId: "s:onStage", surface: stageSurface("quick", "onStage"), takesInput: true },
                ],
            },
        });
        expect(view.stage?.gameUi.map(ui => [ui.slotId, ui.concealed, ui.interactive])).toEqual([
            ["dialog", false, false],
            ["onStage", false, false],
        ]);
        expect(view.layers[0]).toMatchObject({ interactive: true, keyboardOwner: true, modal: true });
    });

    it("marks a layer the host could not put on screen", () => {
        const controller = new LayerStackController();
        const shown = controller.show({ surfaceId: "confirm" });
        const missing = controller.show({ surfaceId: "deleted" });
        const view = describeStack({ controller, renderedLayerKeys: [shown] });
        expect(view.layers.map(layer => [layer.key, layer.onScreen])).toEqual([
            [shown, true],
            [missing, false],
        ]);
        // The surface is gone from the project, so there is no name to show for it.
        expect(view.layers[1]!.surfaceName).toBeNull();
    });

    it("carries a queued layer and the owner that showed it", () => {
        const controller = new LayerStackController();
        controller.show({ surfaceId: "confirm", group: "confirm", ownerScopeId: "menu:1" });
        const queued = controller.show({ surfaceId: "confirm", group: "confirm", ownerScopeId: "menu:1" });
        const view = describeStack({ controller });
        expect(view.layers[0]!.ownerScopeId).toBe("menu:1");
        expect(view.queued).toEqual([{
            key: queued,
            surfaceId: "confirm",
            surfaceName: "Quit Confirm",
            modal: false,
            group: "confirm",
            ownerScopeId: "menu:1",
        }]);
    });
});

describe("listStageSurfaces", () => {
    it("keeps the stage's surfaces and leaves out the pages drawn in frames", () => {
        const dialog = stageSurface("box", "dialog");
        const toasts = stageSurface("toasts", "notification");
        const framed = appSurface("framed");
        expect(listStageSurfaces({
            live: [
                { surface: dialog, runtimeScopeId: "s:dialog" },
                { surface: framed, runtimeScopeId: "frame:1" },
                { surface: toasts, runtimeScopeId: "s:notification" },
            ],
            takingInput: [{ runtimeScopeId: "s:dialog" }],
        })).toEqual([
            { runtimeScopeId: "s:dialog", surface: dialog, takesInput: true },
            { runtimeScopeId: "s:notification", surface: toasts, takesInput: false },
        ]);
    });
});
