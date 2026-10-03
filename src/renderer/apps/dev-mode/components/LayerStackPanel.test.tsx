// @vitest-environment jsdom
/**
 * What the Layers panel puts on screen, for the two facts that have no other witness: the one slot
 * that owns the keyboard, and a layer the stack holds while the screen does not.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GameAppCompositeView } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { LayerStackPanel } from "./LayerStackPanel";

afterEach(cleanup);

const PAGE = {
    key: "menu:1",
    surfaceId: "menu",
    surfaceName: "Main Menu",
    interactive: false,
    keyboardOwner: false,
};

function composite(overrides: Partial<GameAppCompositeView> = {}): GameAppCompositeView {
    return { stage: null, page: PAGE, offScreenPages: [], layers: [], queued: [], exitPending: false, ...overrides };
}

const GAME_UI = [
    {
        key: "nlr:s:slot:dialog:box",
        surfaceId: "box",
        surfaceName: "Dialog box",
        slotId: "dialog" as const,
        concealed: false,
        interactive: true,
        takesInput: true,
    },
    {
        key: "nlr:s:slot:notification:toasts",
        surfaceId: "toasts",
        surfaceName: "Toasts",
        slotId: "notification" as const,
        concealed: false,
        interactive: false,
        takesInput: false,
    },
];

describe("LayerStackPanel", () => {
    it("marks the one slot that owns the keyboard, and says who takes clicks", () => {
        render(<LayerStackPanel composite={composite({
            layers: [{
                key: "layer:confirm:1",
                surfaceId: "confirm",
                surfaceName: "Quit Confirm",
                interactive: true,
                keyboardOwner: true,
                modal: true,
                dismissible: true,
                group: null,
                ownerScopeId: "menu:1",
                onScreen: true,
            }],
        })} />);
        expect(screen.getAllByText("Keyboard")).toHaveLength(1);
        expect(screen.getByText("Takes no clicks")).toBeTruthy();
        expect(screen.getByText("Takes clicks")).toBeTruthy();
        expect(screen.getByText("Shown by Main Menu")).toBeTruthy();
    });

    it("shows the difference between what the stack holds and what the screen has", () => {
        render(<LayerStackPanel composite={composite({
            layers: [{
                key: "layer:deleted:2",
                surfaceId: "deleted",
                surfaceName: null,
                interactive: true,
                keyboardOwner: false,
                modal: false,
                dismissible: true,
                group: "confirm",
                ownerScopeId: "menu:1",
                onScreen: false,
            }],
        })} />);
        expect(screen.getByText("0 of 1 on screen")).toBeTruthy();
        expect(screen.getByText("Not on screen")).toBeTruthy();
        // Named by its id, because the project has no surface to name it after.
        expect(screen.getByText("deleted")).toBeTruthy();
    });

    it("draws the stage and its Game UI under everything, the keys marked once on the group", () => {
        render(<LayerStackPanel composite={composite({
            page: null,
            offScreenPages: [{ key: "title:1", surfaceId: "title", surfaceName: "Title", hiddenForGame: true }],
            stage: { interactive: true, keyboardOwner: true, gameUi: GAME_UI },
        })} />);
        expect(screen.getByText("Stage")).toBeTruthy();
        expect(screen.getByText("Game UI")).toBeTruthy();
        // Slots by their catalogue names, surfaces by their authored ones.
        expect(screen.getByText("Dialog box")).toBeTruthy();
        expect(screen.getByText("Dialog")).toBeTruthy();
        expect(screen.getByText("Notification")).toBeTruthy();
        expect(screen.getByText("Takes no clicks or keys")).toBeTruthy();
        expect(screen.getAllByText("Keyboard")).toHaveLength(1);
        // The page the game hid, under its own heading and not in the stack.
        expect(screen.getByText("Not on screen")).toBeTruthy();
        expect(screen.getByText("Title")).toBeTruthy();
        expect(screen.getByText("Hidden while the game runs")).toBeTruthy();
    });

    it("says which Game UI a page over the stage has faded out", () => {
        render(<LayerStackPanel composite={composite({
            page: { ...PAGE, interactive: true, keyboardOwner: true },
            stage: {
                interactive: false,
                keyboardOwner: false,
                gameUi: [{ ...GAME_UI[0]!, concealed: true, interactive: false }, GAME_UI[1]!],
            },
        })} />);
        expect(screen.getAllByText("Faded out")).toHaveLength(1);
        expect(screen.getAllByText("Keyboard")).toHaveLength(1);
    });

    it("lists what is waiting for a group, and an exit that has not finished", () => {
        render(<LayerStackPanel composite={composite({
            queued: [{
                key: "layer:confirm:3",
                surfaceId: "confirm",
                surfaceName: "Quit Confirm",
                modal: true,
                group: "confirm",
                ownerScopeId: "menu:1",
            }],
            exitPending: true,
        })} />);
        expect(screen.getByText("Waiting for a group")).toBeTruthy();
        expect(screen.getByText("Group: confirm")).toBeTruthy();
        expect(screen.getByText("A layer is still leaving the screen")).toBeTruthy();
    });
});
