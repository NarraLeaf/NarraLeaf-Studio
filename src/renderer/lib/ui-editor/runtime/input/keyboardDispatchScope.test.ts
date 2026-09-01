import { describe, expect, it } from "vitest";
import { resolveKeyboardDispatchScope } from "./keyboardDispatchScope";

describe("resolveKeyboardDispatchScope", () => {
    it("dispatches the global blueprint's key heads while the stage owns the screen", () => {
        // The regression this module exists for: the whole keyboard dispatch used to be installed
        // only while a page was drawn, so a global head bound to F4 worked on the title screen and
        // went silent the moment the story started - which is where a debug key is wanted most.
        const scope = resolveKeyboardDispatchScope({ gameReady: true, surfaceKeyboardReady: false });
        expect(scope.global).toBe(true);
        expect(scope.surface).toBe(false);
    });

    it("dispatches both halves when a page is drawn and owns the keyboard", () => {
        expect(resolveKeyboardDispatchScope({ gameReady: true, surfaceKeyboardReady: true })).toEqual({
            global: true,
            surface: true,
        });
    });

    it("keeps the page half off while a layer owns the keyboard", () => {
        // What the page gate protects: an Escape belongs to the modal on top, not to the page under
        // it. Taking the global half out of that gate does not widen this one.
        expect(resolveKeyboardDispatchScope({ gameReady: true, surfaceKeyboardReady: false }).surface).toBe(false);
    });

    it("dispatches nothing before there is a game app to dispatch into", () => {
        expect(resolveKeyboardDispatchScope({ gameReady: false, surfaceKeyboardReady: true })).toEqual({
            global: false,
            surface: false,
        });
    });
});
