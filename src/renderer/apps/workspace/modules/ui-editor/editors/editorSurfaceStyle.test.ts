import { describe, expect, it } from "vitest";
import type { UISurface } from "@shared/types/ui-editor/document";
import { getEditorSurfaceStyle } from "./editorSurfaceStyle";

const surface = {
    id: "title",
    name: "Title",
    kind: "page",
    designSize: { width: 1920, height: 1080 },
    settings: {},
} as unknown as UISurface;

describe("getEditorSurfaceStyle", () => {
    // A game, a placement and the panel thumbnails clip at the frame. The editing canvas must not:
    // an element dragged off the page has to stay where the author can see it and drag it back.
    it("never clips a page at its edge", () => {
        expect(getEditorSurfaceStyle(surface, false)?.overflow).toBe("visible");
    });

    it("never clips a component at its edge", () => {
        expect(getEditorSurfaceStyle(surface, true)?.overflow).toBe("visible");
    });

    // Other Game UI can be drawn under a Game UI surface as a reference; a fill added here would
    // cover it on the canvas while the game shows straight through.
    it("adds no fill to a transparent Game UI surface", () => {
        const gameUi = {
            ...surface,
            kind: "stageSurface",
            host: "player",
            mount: { kind: "slot", slotId: "onStage" },
        } as unknown as UISurface;
        const style = getEditorSurfaceStyle(gameUi, false);
        expect(style?.backgroundColor).toBeUndefined();
        expect(style?.outline).toBeTruthy();
    });
});
