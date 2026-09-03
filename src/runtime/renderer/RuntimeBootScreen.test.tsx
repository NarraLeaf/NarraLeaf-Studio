// @vitest-environment jsdom
/**
 * The loading state a shipped game starts in.
 *
 * Three things it has to keep doing, and all three used to be the absence of anything: it has to be
 * painted in the game's own colour rather than black, it has to say whether it is counting or just
 * waiting, and it has to go away when the game paints. The last one is the one that would be worst
 * to lose - a loading screen that never lifts is a game that never starts.
 *
 * Comments in English per project convention.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// The vitest alias maps `@` at the Studio renderer, so `@/lib/i18n` would resolve to the editor's
// live store rather than the fixed-locale shim the runtime bundle is built with.
vi.mock("@/lib/i18n", () => ({
    translate: (key: string) => key,
}));

import { RuntimeBootScreen } from "./RuntimeBootScreen";
import { publishRuntimeBootProgress, resetRuntimeBootProgress } from "./bootProgress";

beforeEach(() => {
    resetRuntimeBootProgress();
});

afterEach(() => {
    cleanup();
    resetRuntimeBootProgress();
});

const COLORS = { background: "#0A090D", accent: "#F2F4F7" };

describe("the loading state", () => {
    it("paints the colour it is given rather than black", () => {
        const { container } = render(<RuntimeBootScreen {...COLORS} />);
        const screenEl = container.firstElementChild as HTMLElement;
        expect(screenEl.style.backgroundColor).toBe("rgb(10, 9, 13)");
    });

    it("waits without a count where the phase cannot report one", () => {
        publishRuntimeBootProgress({ phase: "story", at: 120 });
        render(<RuntimeBootScreen {...COLORS} />);
        const bar = screen.getByRole("progressbar");
        // No value at all, not a value of zero: an indeterminate bar that claimed 0% would be read
        // out as a game that has made no progress rather than one whose progress is unknown.
        expect(bar.getAttribute("aria-valuenow")).toBeNull();
        expect(bar.querySelectorAll(".animate-progress-indeterminate-1")).toHaveLength(1);
        expect(bar.querySelectorAll(".animate-progress-indeterminate-2")).toHaveLength(1);
    });

    it("counts where the phase knows both numbers", () => {
        publishRuntimeBootProgress({ phase: "preload", loaded: 3, total: 4, at: 200 });
        render(<RuntimeBootScreen {...COLORS} />);
        const bar = screen.getByRole("progressbar");
        expect(bar.getAttribute("aria-valuenow")).toBe("75");
        expect(bar.querySelector(".animate-progress-indeterminate-1")).toBeNull();
        expect((bar.firstElementChild as HTMLElement).style.width).toBe("75%");
    });

    it("has an accessible name from the catalogue, and nothing an author has to translate", () => {
        render(<RuntimeBootScreen {...COLORS} />);
        expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("common.loading");
        expect(screen.getByRole("progressbar").textContent).toBe("");
    });

    it("goes away when the game paints", () => {
        const { container } = render(<RuntimeBootScreen {...COLORS} />);
        expect(container.firstElementChild).not.toBeNull();
        act(() => publishRuntimeBootProgress({ phase: "firstFrame", at: 900 }));
        expect(container.firstElementChild).toBeNull();
    });

    it("does not come back once the game has painted", () => {
        // A hot reload compiles the story again, and a relaunch mounts a new session. Neither is a
        // boot, and covering a game the player is looking at would be worse than the black window
        // this replaced.
        const { container } = render(<RuntimeBootScreen {...COLORS} />);
        act(() => publishRuntimeBootProgress({ phase: "firstFrame", at: 900 }));
        act(() => publishRuntimeBootProgress({ phase: "story", at: 4000 }));
        expect(container.firstElementChild).toBeNull();
    });
});
