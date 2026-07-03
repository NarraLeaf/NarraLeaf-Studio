import { describe, expect, it } from "vitest";
import { resolveDevModeViewportSize } from "./devModeViewport";

describe("resolveDevModeViewportSize", () => {
    it("uses the active surface size before a game session exists", () => {
        expect(
            resolveDevModeViewportSize({
                activeSurfaceDesignSize: { width: 800, height: 600 },
                gameViewport: null,
            }),
        ).toEqual({ width: 800, height: 600 });
    });

    it("keeps the game viewport while an overlay page has a different size", () => {
        expect(
            resolveDevModeViewportSize({
                activeSurfaceDesignSize: { width: 1024, height: 768 },
                gameViewport: { width: 1280, height: 720 },
            }),
        ).toEqual({ width: 1280, height: 720 });
    });

    it("falls back to the active surface size for invalid game viewport data", () => {
        expect(
            resolveDevModeViewportSize({
                activeSurfaceDesignSize: { width: 1024, height: 768 },
                gameViewport: { width: 0, height: 720 },
            }),
        ).toEqual({ width: 1024, height: 768 });
    });
});
