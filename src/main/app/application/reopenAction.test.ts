import { describe, expect, it } from "vitest";
import { decideReopenAction } from "./reopenAction";

describe("decideReopenAction", () => {
    it("leaves a reopen that already brought windows forward alone", () => {
        expect(decideReopenAction({ hasVisibleWindows: true, windowsOnScreen: 1 })).toBe("none");
    });

    it("opens the home screen only when nothing is on screen", () => {
        expect(decideReopenAction({ hasVisibleWindows: false, windowsOnScreen: 0 })).toBe("launcher");
    });

    it("raises what the reopen could not when every window is minimized", () => {
        expect(decideReopenAction({ hasVisibleWindows: false, windowsOnScreen: 2 })).toBe("raise");
    });

    it("treats a held-back launcher as nothing on screen", () => {
        // The window exists, but has never been shown - `windowsOnScreen` does not count it.
        expect(decideReopenAction({ hasVisibleWindows: false, windowsOnScreen: 0 })).toBe("launcher");
    });
});
