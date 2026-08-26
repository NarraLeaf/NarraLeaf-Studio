// @vitest-environment jsdom
/**
 * Which device the player is using, and what it answers before they have used any.
 *
 * The second half is the one worth a test of its own. A title page is the moment nothing has been
 * pressed yet and also the moment the prompt on screen most needs to be right, so the answer given
 * to nobody-has-touched-anything is not a placeholder - it is the answer that ships.
 *
 * Comments in English per project convention.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
    createInputDeviceTracker,
    readCurrentInputDevice,
    noteInputDevice,
    resetSharedInputDeviceTracker,
    UI_COARSE_POINTER_QUERY,
    type UIInputDeviceHost,
} from "./inputDeviceState";

/** A window whose `matchMedia` answers whatever this test needs it to. */
function hostWithMedia(coarse: boolean | "absent" | "throws"): UIInputDeviceHost {
    return {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        ...(coarse === "absent"
            ? {}
            : {
                  matchMedia: (query: string) => {
                      if (coarse === "throws") {
                          throw new Error("unrecognised media query");
                      }
                      expect(query).toBe(UI_COARSE_POINTER_QUERY);
                      return { matches: coarse };
                  },
              }),
    };
}

describe("what it answers before any input", () => {
    it("reads touch on a device whose primary pointer is coarse", () => {
        // Phones and tablets. The title page has to say "Tap to start" on the first frame, before
        // there is any input to read the device off.
        expect(createInputDeviceTracker(hostWithMedia(true)).read()).toBe("touch");
    });

    it("reads pointer on everything else, a touch-screen laptop included", () => {
        // `(pointer: coarse)` asks about the *primary* device, so a laptop with a touch screen
        // bolted on does not match it - its primary device is still the trackpad.
        expect(createInputDeviceTracker(hostWithMedia(false)).read()).toBe("pointer");
    });

    it("falls back to pointer where the question cannot be asked", () => {
        expect(createInputDeviceTracker(hostWithMedia("absent")).read()).toBe("pointer");
        // Some embedded webviews throw on a query they do not recognise rather than answering false.
        expect(createInputDeviceTracker(hostWithMedia("throws")).read()).toBe("pointer");
        expect(createInputDeviceTracker(null).read()).toBe("pointer");
    });
});

describe("what the player just used", () => {
    afterEach(() => {
        resetSharedInputDeviceTracker();
    });

    it("reads each of the three devices off the input that produced it", () => {
        const tracker = createInputDeviceTracker(window);

        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(tracker.read()).toBe("key");

        window.dispatchEvent(pointerDown("touch"));
        expect(tracker.read()).toBe("touch");

        window.dispatchEvent(pointerDown("mouse"));
        expect(tracker.read()).toBe("pointer");

        // A pen aims at a point the way a mouse does, so everything an interface would phrase
        // differently for a mouse it phrases the same way for a pen.
        window.dispatchEvent(pointerDown("pen"));
        expect(tracker.read()).toBe("pointer");

        tracker.dispose();
    });

    it("stops listening once disposed", () => {
        const tracker = createInputDeviceTracker(window);
        tracker.dispose();

        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

        expect(tracker.read()).toBe("pointer");
    });

    it("answers through the shared tracker, and takes a device something else observed", () => {
        expect(readCurrentInputDevice()).toBe("pointer");

        noteInputDevice("touch");

        expect(readCurrentInputDevice()).toBe("touch");
    });
});

/** A `pointerdown` carrying a `pointerType`, which jsdom's `MouseEvent` does not copy across. */
function pointerDown(pointerType: string): Event {
    const event = new MouseEvent("pointerdown", { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    return event;
}
