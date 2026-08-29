// @vitest-environment jsdom
/**
 * `Is Action Held`, from the hardware up.
 *
 * Three things are defended, and the middle one is the reason this file needs a DOM at all:
 *
 * 1. **A binding reads as held by the same rules it fires by.** Keys go through the matcher the
 *    `On Key Down` heads use, so a binding cannot fire an action and read as not held; and the
 *    gestures that are not a press - a wheel notch, a double click - never read as held, because
 *    there is no moment during which one of those is happening.
 * 2. **Nothing sticks.** A key released under Meta, a window that loses focus mid-hold, a pointer
 *    the browser takes away: each of them delivers no release, and a hold that survives one of them
 *    is a game that fast-forwards until it is closed.
 * 3. **The surface is what says how the action is raised.** The vocabulary is the project's, but a
 *    surface that overrides the bindings - or takes them away - has to be answered with its own.
 *
 * Comments in English per project convention.
 */

import { afterEach, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { UIInputBinding, UIInputPointerGesture } from "@shared/types/ui-editor/inputAction";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { createDevModeBlueprintHostApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import {
    createInputHoldTracker,
    getSharedInputHoldTracker,
    isInputBindingHeld,
    resetSharedInputHoldTracker,
    type UIHeldInputs,
} from "./inputHoldState";

function held(keys: string[] = [], buttons: number[] = [], gestures: UIInputPointerGesture[] = []): UIHeldInputs {
    return { keys: new Set(keys), buttons: new Set(buttons), gestures: new Set(gestures) };
}

const KEY = (key: string): UIInputBinding => ({ kind: "key", key });

describe("one binding against the player's hands", () => {
    it("matches a key by the spelling the heads match by", () => {
        expect(isInputBindingHeld(KEY("Escape"), held(["escape"]))).toBe(true);
        // The author typed "esc"; `normalizeUIInputBinding` stores "Escape" and the parser accepts
        // either. What must not happen is a binding that fires but reads as not held.
        expect(isInputBindingHeld(KEY("esc"), held(["escape"]))).toBe(true);
        expect(isInputBindingHeld(KEY("Escape"), held(["enter"]))).toBe(false);
    });

    it("reads the modifiers off the hand rather than off the press that started it", () => {
        expect(isInputBindingHeld(KEY("Ctrl+S"), held(["s"]))).toBe(false);
        // Ctrl arrived after S. The player is holding Ctrl+S now, whatever they were holding when
        // the S went down.
        expect(isInputBindingHeld(KEY("Ctrl+S"), held(["s", "control"]))).toBe(true);
        // A binding with no modifier token says nothing about them, exactly as a key head does.
        expect(isInputBindingHeld(KEY("S"), held(["s", "control"]))).toBe(true);
        expect(isInputBindingHeld(KEY("Ctrl"), held(["control"]))).toBe(true);
    });

    it("holds the two pointer gestures that are a press, and neither of the ones that are not", () => {
        expect(isInputBindingHeld({ kind: "pointer", gesture: "click" }, held([], [0]))).toBe(true);
        expect(isInputBindingHeld({ kind: "pointer", gesture: "click" }, held([], [2]))).toBe(false);
        expect(isInputBindingHeld({ kind: "pointer", gesture: "rightClick" }, held([], [2]))).toBe(true);
        // A wheel notch is instantaneous, and a double click is a sequence rather than a state: a
        // button held down is not a double click in progress, however long it is held.
        expect(isInputBindingHeld({ kind: "pointer", gesture: "wheelDown" }, held([], [0, 1, 2]))).toBe(false);
        expect(isInputBindingHeld({ kind: "pointer", gesture: "doubleClick" }, held([], [0]))).toBe(false);
    });

    it("holds a long press from what recognised it rather than from the button under it", () => {
        // The whole reason `longPress` is not in the button table. A finger's press puts button 0
        // down from the first millisecond, and a long press has not happened yet at that point.
        expect(isInputBindingHeld({ kind: "pointer", gesture: "longPress" }, held([], [0]))).toBe(false);
        expect(isInputBindingHeld({ kind: "pointer", gesture: "longPress" }, held([], [0], ["longPress"]))).toBe(true);
        // And the same press still answers for `click`, which is correct: the main button really is
        // down. Two gestures being held at once is what a held finger is.
        expect(isInputBindingHeld({ kind: "pointer", gesture: "click" }, held([], [0], ["longPress"]))).toBe(true);
    });
});

describe("the tracker over a window", () => {
    const trackers: Array<{ dispose: () => void }> = [];

    afterEach(() => {
        while (trackers.length) {
            trackers.pop()?.dispose();
        }
        document.body.innerHTML = "";
    });

    function attach() {
        const tracker = createInputHoldTracker(window);
        trackers.push(tracker);
        return tracker;
    }

    function keyDown(key: string, target: EventTarget = window): void {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }

    function keyUp(key: string, target: EventTarget = window): void {
        target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    }

    function pointer(type: string, button: number, target: EventTarget = window): void {
        target.dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
    }

    it("holds a key from its press to its release", () => {
        const tracker = attach();

        keyDown(" ");
        expect(isInputBindingHeld(KEY("Space"), tracker.read())).toBe(true);

        keyUp(" ");
        expect(isInputBindingHeld(KEY("Space"), tracker.read())).toBe(false);
    });

    it("does not read typing as a gesture", () => {
        const tracker = attach();
        const field = document.createElement("input");
        field.type = "text";
        document.body.appendChild(field);

        keyDown("s", field);

        expect(tracker.read().keys.size).toBe(0);
    });

    it("forgets everything when the window loses focus", () => {
        const tracker = attach();

        keyDown("Shift");
        pointer("pointerdown", 0);
        expect(tracker.read().keys.size).toBe(1);

        // Alt-Tab: the release happens inside whatever the player switched to and never arrives
        // here. A hold that outlived this would never end.
        window.dispatchEvent(new Event("blur"));

        expect(tracker.read()).toEqual({ keys: new Set(), buttons: new Set(), gestures: new Set() });
    });

    it("forgets the rest of the keyboard when Meta is released", () => {
        const tracker = attach();

        keyDown("Meta");
        keyDown("s");
        // macOS delivers no keyup for S while Meta is down, so this is the last moment anything
        // about S can be believed.
        keyUp("Meta");

        expect(tracker.read().keys.size).toBe(0);
    });

    it("remembers where the press that is holding a gesture landed", () => {
        const tracker = attach();
        const target = document.createElement("div");
        document.body.appendChild(target);

        pointer("pointerdown", 0, target);
        expect(tracker.readPressTarget("click")).toBe(target);
        // Nothing holds a gesture that is not a press, so nothing can have started one.
        expect(tracker.readPressTarget("wheelDown")).toBeNull();

        pointer("pointerup", 0, target);
        expect(tracker.readPressTarget("click")).toBeNull();
    });

    it("holds a recognised long press from the moment it is recognised until the hand leaves", () => {
        const tracker = attach();
        const backdrop = document.createElement("div");
        document.body.appendChild(backdrop);

        // The finger is down but the press is not a long one yet. This is the half-second an author
        // must not see "held": "hold to hide the dialogue" firing on every tap is the bug.
        pointer("pointerdown", 0, backdrop);
        expect(isInputBindingHeld({ kind: "pointer", gesture: "longPress" }, tracker.read())).toBe(false);

        tracker.holdGesture("longPress", backdrop);
        expect(isInputBindingHeld({ kind: "pointer", gesture: "longPress" }, tracker.read())).toBe(true);
        // `overControls` asks the same question of a held gesture that it asks of a press: what was
        // under the finger when it went down.
        expect(tracker.readPressTarget("longPress")).toBe(backdrop);

        tracker.releaseGestures();
        expect(isInputBindingHeld({ kind: "pointer", gesture: "longPress" }, tracker.read())).toBe(false);
        expect(tracker.readPressTarget("longPress")).toBeNull();
    });

    it("refuses to hold a gesture that is an instant rather than a state", () => {
        const tracker = attach();

        tracker.holdGesture("wheelDown", document.body);

        // A wheel direction has no duration to hold. Refused at the door so no recogniser can make
        // one sticky by pushing it through here.
        expect(tracker.read().gestures.size).toBe(0);
    });

    it("forgets a held gesture when the window loses focus", () => {
        const tracker = attach();
        tracker.holdGesture("longPress", document.body);

        window.dispatchEvent(new Event("blur"));

        expect(tracker.read().gestures.size).toBe(0);
    });

    it("drops a pointer the browser has taken away", () => {
        const tracker = attach();

        pointer("pointerdown", 0);
        // `pointercancel` names no button, so there is nothing to release selectively.
        window.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true }));

        expect(tracker.read().buttons.size).toBe(0);
    });

    it("stops listening once disposed", () => {
        const tracker = createInputHoldTracker(window);
        tracker.dispose();

        keyDown("Escape");

        expect(tracker.read().keys.size).toBe(0);
    });

    it("reads nothing held where there is no window to listen to", () => {
        const tracker = createInputHoldTracker(null);
        expect(tracker.read()).toEqual({ keys: new Set(), buttons: new Set(), gestures: new Set() });
        expect(tracker.readPressTarget("click")).toBeNull();
    });
});

describe("hostApi.input.isActionHeld", () => {
    afterEach(() => {
        resetSharedInputHoldTracker();
        document.body.innerHTML = "";
    });

    function createDocument(surfaceActions: UIDocument["surfaces"][number]["actions"]): UIDocument {
        return {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            actions: {
                advance: { id: "advance", name: "Advance", bindings: [{ kind: "key", key: "Space" }] },
                dismiss: { id: "dismiss", name: "Dismiss", bindings: [{ kind: "pointer", gesture: "click" }] },
            },
            surfaces: [
                {
                    id: "page",
                    name: "Page",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root",
                    actions: surfaceActions,
                },
            ],
            elements: {
                root: { id: "root", type: "nl.root", name: "Root", children: [], layout: {} },
                back: { id: "back", type: "nl.button", name: "Back", children: [], layout: {} },
            },
        } as unknown as UIDocument;
    }

    function createHostApi(surfaceActions: UIDocument["surfaces"][number]["actions"]) {
        return createDevModeBlueprintHostApi({
            document: createDocument(surfaceActions),
            scope: new ScopeStoreBridge(),
            activeSurfaceId: "page",
            emit: () => undefined,
            onOpenSurface: () => undefined,
            onPageBack: () => undefined,
            onWidgetPatch: () => undefined,
            widgetRuntimeStore: new WidgetRuntimeStateStore(),
        });
    }

    /** Put the shared tracker on this window before anything is pressed in front of it. */
    function armTracker(): void {
        getSharedInputHoldTracker();
    }

    it("answers from the action's own bindings", () => {
        armTracker();
        const hostApi = createHostApi([{ actionId: "advance" }]);

        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

        // One action, one set of gestures, wherever it is answered. There is no per-surface set to
        // fall back from any more.
        expect(hostApi.input.isActionHeld("advance")).toBe(true);
    });

    it("reads an action this surface does not answer as never held", () => {
        armTracker();
        const hostApi = createHostApi([]);

        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

        // The interface answers nothing here, so nothing is held here either - which is the same
        // sentence as "pressing it there fires nothing".
        expect(hostApi.input.isActionHeld("advance")).toBe(false);
    });

    it("reads an action the project does not define as not held rather than throwing", () => {
        armTracker();
        const hostApi = createHostApi(undefined);

        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

        expect(hostApi.input.isActionHeld("openLog")).toBe(false);
        expect(hostApi.input.isActionHeld("   ")).toBe(false);
    });

    it("stands a pointer hold down over a control", () => {
        armTracker();
        const button = document.createElement("div");
        button.setAttribute("data-ui-element-id", "back");
        document.body.appendChild(button);
        const hostApi = createHostApi([{ actionId: "dismiss" }]);

        button.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true }));

        // A panel-wide "hold to dismiss" must not run while the player is holding the Back button.
        expect(hostApi.input.isActionHeld("dismiss")).toBe(false);
    });

    it("holds a pointer gesture pressed on scenery", () => {
        armTracker();
        const backdrop = document.createElement("div");
        backdrop.setAttribute("data-ui-element-id", "root");
        document.body.appendChild(backdrop);
        const hostApi = createHostApi([{ actionId: "dismiss" }]);

        backdrop.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true }));

        expect(hostApi.input.isActionHeld("dismiss")).toBe(true);
    });
});
