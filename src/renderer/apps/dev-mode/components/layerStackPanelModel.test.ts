import { describe, expect, it } from "vitest";
import type { UIAppSurface, UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";
import type {
    GameAppCompositeLayer,
    GameAppCompositeView,
} from "@/lib/ui-editor/runtime/app/GameAppHost";
import { resolveKeyboardOwnerEntry, resolveKeyboardOwnerLane } from "@/lib/ui-editor/runtime/app/keyboardOwner";
import { LayerStackController } from "@/lib/ui-editor/runtime/app/layers/LayerStackController";
import { resolveCompositeInput } from "@/lib/ui-editor/runtime/app/layers/compositeInput";
import { buildCompositeView, listStageSurfaces } from "@/lib/ui-editor/runtime/app/layers/compositeView";
import {
    isPageEntryDrawn,
    isStageCovered,
    isStageCoveredByPage,
} from "@/lib/ui-editor/runtime/app/layers/stageOcclusion";
import {
    buildCompositeStackView,
    type CompositeStackGameUiRow,
    type CompositeStackLayerRow,
    type CompositeStackRow,
    type CompositeStackStageRow,
} from "./layerStackPanelModel";

function layer(overrides: Partial<GameAppCompositeLayer> = {}): GameAppCompositeLayer {
    return {
        key: "layer:confirm:1",
        surfaceId: "confirm",
        surfaceName: "Quit Confirm",
        interactive: true,
        keyboardOwner: false,
        modal: false,
        dismissible: true,
        group: null,
        ownerScopeId: "menu:1",
        onScreen: true,
        ...overrides,
    };
}

function composite(overrides: Partial<GameAppCompositeView> = {}): GameAppCompositeView {
    return {
        stage: null,
        page: {
            key: "menu:1",
            surfaceId: "menu",
            surfaceName: "Main Menu",
            interactive: true,
            keyboardOwner: true,
        },
        offScreenPages: [],
        layers: [],
        queued: [],
        exitPending: false,
        ...overrides,
    };
}

describe("buildCompositeStackView", () => {
    it("reads bottom to top, page lane first", () => {
        const view = buildCompositeStackView(composite({
            layers: [
                layer({ key: "layer:confirm:1" }),
                layer({ key: "layer:confirm:2", modal: true, keyboardOwner: true }),
            ],
        }));
        expect(view.rows.map(row => [row.kind, row.key])).toEqual([
            ["page", "menu:1"],
            ["layer", "layer:confirm:1"],
            ["layer", "layer:confirm:2"],
        ]);
    });

    it("keeps only the tail of a key, which is what tells two mounts apart", () => {
        const view = buildCompositeStackView(composite({
            layers: [layer({ key: "layer:confirm:7" })],
        }));
        expect(view.rows.map(row => ("keyTail" in row ? row.keyTail : null))).toEqual(["1", "7"]);
    });

    it("names a layer by its surface, and by its id when the project has no such surface", () => {
        const view = buildCompositeStackView(composite({
            layers: [layer({ key: "layer:deleted:3", surfaceId: "deleted", surfaceName: null })],
        }));
        expect(view.rows[1]).toMatchObject({ label: "deleted", surfaceMissing: true });
        expect(view.rows[0]).toMatchObject({ label: "Main Menu", surfaceMissing: false });
    });

    it("counts what the stack holds against what the screen has", () => {
        const view = buildCompositeStackView(composite({
            layers: [
                layer({ key: "layer:confirm:1" }),
                layer({ key: "layer:deleted:2", surfaceName: null, onScreen: false }),
            ],
        }));
        expect(view.layerCount).toBe(2);
        expect(view.onScreenCount).toBe(1);
        expect((view.rows[2] as CompositeStackLayerRow).onScreen).toBe(false);
    });

    it("names an owner by its own row, and leaves an unknown scope as it is", () => {
        const view = buildCompositeStackView(composite({
            offScreenPages: [{ key: "title:1", surfaceId: "title", surfaceName: "Title", hiddenForGame: false }],
            layers: [
                layer({ key: "layer:confirm:1", ownerScopeId: "menu:1" }),
                layer({ key: "layer:confirm:2", ownerScopeId: "layer:confirm:1" }),
                layer({ key: "layer:confirm:3", ownerScopeId: "frame:9" }),
                layer({ key: "layer:confirm:4", ownerScopeId: "" }),
                layer({ key: "layer:confirm:5", ownerScopeId: "title:1" }),
            ],
        }));
        expect(view.rows.slice(1).map(row => (row as CompositeStackLayerRow).owner)).toEqual([
            "Main Menu",
            "Quit Confirm",
            "frame:9",
            null,
            "Title",
        ]);
    });

    it("carries the queue and the pending exit through", () => {
        const view = buildCompositeStackView(composite({
            layers: [layer({ key: "layer:confirm:1", group: "confirm" })],
            queued: [{
                key: "layer:confirm:2",
                surfaceId: "confirm",
                surfaceName: "Quit Confirm",
                modal: true,
                group: "confirm",
                ownerScopeId: "menu:1",
            }],
            exitPending: true,
        }));
        expect(view.queued).toEqual([{
            kind: "queued",
            key: "layer:confirm:2",
            keyTail: "2",
            label: "Quit Confirm",
            surfaceMissing: false,
            modal: true,
            group: "confirm",
            owner: "Main Menu",
        }]);
        expect(view.exitPending).toBe(true);
    });

    it("reports an empty composite as no rows at all", () => {
        const view = buildCompositeStackView(composite({ page: null }));
        expect(view.rows).toEqual([]);
        expect(view.offScreenPages).toEqual([]);
        expect(view.layerCount).toBe(0);
    });

    it("marks the stage itself when it owns the keys and has no Game UI to hear them", () => {
        const view = buildCompositeStackView(composite({
            page: null,
            stage: { interactive: true, keyboardOwner: true, gameUi: [] },
        }));
        expect(view.rows).toEqual([{ kind: "stage", key: "stage", interactive: true, keyboardOwner: true }]);
    });
});

/*
 * The screens of a playthrough, assembled the way the game app assembles them: the same arbitration
 * functions over the same inputs, so what the panel says can be checked against the runtime's rules
 * rather than against a fixture that already holds the answer.
 */
const NAMES: Record<string, string> = { title: "Title", log: "Log", confirm: "Confirm" };

function page(id: string): UIAppSurface {
    return {
        id,
        name: NAMES[id] ?? id,
        host: "app",
        kind: "appSurface",
        designSize: { width: 1920, height: 1080 },
        rootElementId: `${id}-root`,
    };
}

function stageSurface(id: string, name: string, slotId: UIStageSlotId): UIStageSurface {
    return {
        id,
        name,
        host: "player",
        kind: "stageSurface",
        designSize: { width: 1920, height: 1080 },
        rootElementId: `${id}-root`,
        mount: { kind: "slot", slotId },
    };
}

/** What the starter project has on the stage while a line is showing. */
const STAGE_LIVE = [
    { surface: stageSurface("dialog", "Dialog box", "dialog"), runtimeScopeId: "nlr:s:slot:dialog:dialog" },
    { surface: stageSurface("quick", "Quick menu", "onStage"), runtimeScopeId: "nlr:s:slot:onStage:quick" },
    { surface: stageSurface("toasts", "Notifications", "notification"), runtimeScopeId: "nlr:s:slot:notification:toasts" },
];

function screen(input: {
    pageStack: readonly { key: string; surfaceId: string }[];
    /** The entries a running game hid, or null when no game is running. */
    gameHiddenKeys: readonly string[] | null;
    controller?: LayerStackController;
}) {
    const inGame = input.gameHiddenKeys !== null;
    const gameHiddenKeys = new Set(input.gameHiddenKeys ?? []);
    const snapshot = (input.controller ?? new LayerStackController()).getSnapshot();
    const top = input.pageStack[input.pageStack.length - 1] ?? null;
    const drawn = (key: string) => isPageEntryDrawn({ entryKey: key, pagesHiddenForGame: inGame, gameHiddenKeys });
    const resolution = resolveCompositeInput({
        pageEntries: top && drawn(top.key) ? [top] : [],
        activePageKey: top?.key ?? null,
        layers: snapshot.layers,
    });
    const owner = resolveKeyboardOwnerEntry<{ key: string }>({
        keyboardOwnerKey: resolution.keyboardOwnerKey,
        page: top ? { entry: top, surface: page(top.surfaceId), ready: drawn(top.key) } : null,
        layers: snapshot.layers.map(entry => ({ entry, surface: page(entry.surfaceId), ready: true })),
    });
    const occlusion = {
        pageEntries: input.pageStack,
        pagesHiddenForGame: inGame,
        gameHiddenKeys,
        layers: snapshot.layers,
    };
    const storyOnScreen = inGame && !isStageCovered(occlusion);
    return buildCompositeStackView(buildCompositeView({
        pageStack: input.pageStack,
        pagesHiddenForGame: inGame,
        gameHiddenKeys,
        layers: snapshot.layers,
        queued: snapshot.queued,
        renderedLayerKeys: new Set(snapshot.layers.map(entry => entry.key)),
        resolution,
        keyboardLane: resolveKeyboardOwnerLane({ entry: owner?.entry ?? null, isStoryOnScreen: () => storyOnScreen }),
        stage: inGame
            ? {
                storyOnScreen,
                coveredByPage: isStageCoveredByPage(occlusion),
                pointerLive: true,
                surfaces: listStageSurfaces({
                    live: STAGE_LIVE,
                    // The notifications are display-only and never register for the keys.
                    takingInput: STAGE_LIVE.filter(target => target.surface.mount.slotId !== "notification"),
                }),
            }
            : null,
        exitPending: snapshot.exitPending,
        surfaceName: surfaceId => NAMES[surfaceId] ?? null,
    }));
}

function keyboardRows(rows: readonly CompositeStackRow[]): string[] {
    return rows.filter(row => row.keyboardOwner).map(row => `${row.kind}:${row.key}`);
}

function gameUiOf(rows: readonly CompositeStackRow[]): CompositeStackGameUiRow {
    return rows.find((row): row is CompositeStackGameUiRow => row.kind === "gameUi")!;
}

describe("the Layers panel over a playthrough", () => {
    it("on the title screen, lists the page alone and hands it the keys", () => {
        const view = screen({ pageStack: [{ key: "title:1", surfaceId: "title" }], gameHiddenKeys: null });
        expect(view.rows.map(row => row.kind)).toEqual(["page"]);
        expect(keyboardRows(view.rows)).toEqual(["page:title:1"]);
    });

    it("in a game with no page open, lists no page and hands the keys to the Game UI", () => {
        const view = screen({ pageStack: [{ key: "title:1", surfaceId: "title" }], gameHiddenKeys: ["title:1"] });
        expect(view.rows.map(row => row.kind)).toEqual(["stage", "gameUi"]);
        expect(keyboardRows(view.rows)).toEqual(["gameUi:gameUi"]);
        expect((view.rows[0] as CompositeStackStageRow).interactive).toBe(true);
        expect(gameUiOf(view.rows).surfaces.map(ui => [ui.label, ui.concealed, ui.interactive, ui.takesInput])).toEqual([
            ["Dialog box", false, true, true],
            ["Quick menu", false, true, true],
            ["Notifications", false, false, false],
        ]);
        // The page the game hid is not on screen, and says why.
        expect(view.offScreenPages.map(row => [row.label, row.hiddenForGame])).toEqual([["Title", true]]);
    });

    it("with a page open over the game, hands the page the keys and fades every slot but notifications", () => {
        const view = screen({
            pageStack: [{ key: "title:1", surfaceId: "title" }, { key: "log:4", surfaceId: "log" }],
            gameHiddenKeys: ["title:1"],
        });
        expect(view.rows.map(row => row.kind)).toEqual(["stage", "gameUi", "page"]);
        expect(keyboardRows(view.rows)).toEqual(["page:log:4"]);
        expect((view.rows[0] as CompositeStackStageRow).interactive).toBe(false);
        expect(gameUiOf(view.rows).surfaces.map(ui => [ui.slotId, ui.concealed, ui.interactive])).toEqual([
            ["dialog", true, false],
            ["onStage", true, false],
            ["notification", false, false],
        ]);
        expect(view.rows[2]).toMatchObject({ label: "Log", interactive: true });
    });

    it("with a modal layer over that page, hands the layer the keys and leaves the page inert", () => {
        const controller = new LayerStackController();
        controller.show({ surfaceId: "confirm", modal: true, dismissible: true, group: "confirm", ownerScopeId: "log:4" });
        const view = screen({
            pageStack: [{ key: "title:1", surfaceId: "title" }, { key: "log:4", surfaceId: "log" }],
            gameHiddenKeys: ["title:1"],
            controller,
        });
        expect(view.rows.map(row => row.kind)).toEqual(["stage", "gameUi", "page", "layer"]);
        expect(keyboardRows(view.rows)).toHaveLength(1);
        expect(keyboardRows(view.rows)[0]).toMatch(/^layer:/);
        expect(view.rows[2]).toMatchObject({ kind: "page", interactive: false, keyboardOwner: false });
        expect(view.rows[3]).toMatchObject({ kind: "layer", interactive: true, owner: "Log" });
        // A layer floats over the screen, so the Game UI stays as the page left it: faded.
        expect(gameUiOf(view.rows).surfaces.filter(ui => ui.concealed).map(ui => ui.slotId)).toEqual(["dialog", "onStage"]);
    });

    it("with a modal layer straight over the stage, hands the layer the keys and fades nothing", () => {
        const controller = new LayerStackController();
        controller.show({ surfaceId: "confirm", modal: true });
        const view = screen({ pageStack: [{ key: "title:1", surfaceId: "title" }], gameHiddenKeys: ["title:1"], controller });
        expect(keyboardRows(view.rows)).toHaveLength(1);
        expect(keyboardRows(view.rows)[0]).toMatch(/^layer:/);
        // The story is held under a modal layer, so a click on the stage no longer reaches it.
        expect((view.rows[0] as CompositeStackStageRow).interactive).toBe(false);
        expect(gameUiOf(view.rows).surfaces.some(ui => ui.concealed)).toBe(false);
    });

    it("after quitting to the title, lists the title alone again", () => {
        const view = screen({ pageStack: [{ key: "title:5", surfaceId: "title" }], gameHiddenKeys: null });
        expect(view.rows.map(row => [row.kind, row.key])).toEqual([["page", "title:5"]]);
        expect(view.offScreenPages).toEqual([]);
        expect(keyboardRows(view.rows)).toEqual(["page:title:5"]);
    });
});
