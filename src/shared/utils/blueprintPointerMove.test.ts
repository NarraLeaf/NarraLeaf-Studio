import { describe, expect, it, vi } from "vitest";
import type { BlueprintPointerMoveResult } from "@shared/types/blueprint/pointer";
import { executeBlueprintPointerMove, type PointerMoveWindow } from "./blueprintPointerMove";

function fakeWindow(overrides: Partial<PointerMoveWindow> = {}): PointerMoveWindow {
    return {
        id: 1,
        isDestroyed: () => false,
        getContentBounds: () => ({ x: 100, y: 200, width: 800, height: 600 }),
        webContents: { getZoomFactor: () => 1 },
        ...overrides,
    };
}

function recorder() {
    const points: Array<{ x: number; y: number }> = [];
    const moveCursor = async (x: number, y: number): Promise<BlueprintPointerMoveResult> => {
        points.push({ x, y });
        return { outcome: "moved" };
    };
    return { points, moveCursor };
}

const screenStub = {
    // A 2x display: physical pixels are twice the device-independent ones.
    dipToScreenPoint: (point: { x: number; y: number }) => ({ x: point.x * 2, y: point.y * 2 }),
    getCursorScreenPoint: () => ({ x: 100, y: 200 }),
};

describe("executeBlueprintPointerMove", () => {
    it("adds the window's content origin and converts to physical pixels", async () => {
        const { points, moveCursor } = recorder();
        const result = await executeBlueprintPointerMove(
            { clientX: 40, clientY: 60 },
            fakeWindow(),
            { screen: screenStub, moveCursor, cursorAvailable: async () => true },
        );
        expect(result.outcome).toBe("moved");
        expect(points).toEqual([{ x: (100 + 40) * 2, y: (200 + 60) * 2 }]);
    });

    it("multiplies the page point by the zoom factor", async () => {
        const { points, moveCursor } = recorder();
        await executeBlueprintPointerMove(
            { clientX: 40, clientY: 60 },
            fakeWindow({ webContents: { getZoomFactor: () => 1.5 } }),
            { screen: null, moveCursor, cursorAvailable: async () => true },
        );
        expect(points).toEqual([{ x: 100 + 60, y: 200 + 90 }]);
    });

    it("clamps a target outside the window to the window's own edges", async () => {
        const { points, moveCursor } = recorder();
        await executeBlueprintPointerMove(
            { clientX: 5000, clientY: -20 },
            fakeWindow(),
            { screen: null, moveCursor, cursorAvailable: async () => true },
        );
        // Not the desktop's edges: a game may position the cursor inside itself and nowhere else.
        expect(points).toEqual([{ x: 100 + 799, y: 200 }]);
    });

    it("reports unsupported without touching the cursor when the host has no support", async () => {
        const { points, moveCursor } = recorder();
        const result = await executeBlueprintPointerMove(
            { clientX: 10, clientY: 10 },
            fakeWindow(),
            { screen: null, moveCursor, cursorAvailable: async () => false },
        );
        expect(result.outcome).toBe("unsupported");
        expect(points).toEqual([]);
    });

    it("falls back to the device-independent point when the screen module throws", async () => {
        const { points, moveCursor } = recorder();
        await executeBlueprintPointerMove(
            { clientX: 10, clientY: 10 },
            fakeWindow(),
            {
                screen: {
                    dipToScreenPoint: () => {
                        throw new Error("no");
                    },
                    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
                },
                moveCursor,
                cursorAvailable: async () => true,
            },
        );
        expect(points).toEqual([{ x: 110, y: 210 }]);
    });

    it("travels through intermediate points and ends on the target", async () => {
        const { points, moveCursor } = recorder();
        let clock = 0;
        const result = await executeBlueprintPointerMove(
            { clientX: 100, clientY: 0, durationSeconds: 0.064, easing: "linear" },
            fakeWindow(),
            {
                screen: {
                    dipToScreenPoint: point => point,
                    // Starting where the window's own origin is, so the path is a clean 0 -> 100.
                    getCursorScreenPoint: () => ({ x: 100, y: 200 }),
                },
                moveCursor,
                cursorAvailable: async () => true,
                now: () => clock,
                sleep: async ms => {
                    clock += ms;
                },
            },
        );
        expect(result.outcome).toBe("moved");
        expect(points.length).toBeGreaterThan(2);
        expect(points[0]).toEqual({ x: 100, y: 200 });
        expect(points.at(-1)).toEqual({ x: 200, y: 200 });
        // Monotonic: a smooth move that backtracks would read as a twitch.
        for (let index = 1; index < points.length; index += 1) {
            expect(points[index]!.x).toBeGreaterThanOrEqual(points[index - 1]!.x);
        }
    });

    it("goes straight to the target when the host will not say where the cursor is", async () => {
        const { points, moveCursor } = recorder();
        await executeBlueprintPointerMove(
            { clientX: 100, clientY: 0, durationSeconds: 1 },
            fakeWindow(),
            { screen: null, moveCursor, cursorAvailable: async () => true },
        );
        expect(points).toEqual([{ x: 200, y: 200 }]);
    });

    it("stops the older move when a second one starts on the same window", async () => {
        const first = recorder();
        const second = recorder();
        let clock = 0;
        const window = fakeWindow();
        const screen = {
            dipToScreenPoint: (point: { x: number; y: number }) => point,
            getCursorScreenPoint: () => ({ x: 100, y: 200 }),
        };
        const pending: Array<() => void> = [];
        const slowMove = executeBlueprintPointerMove(
            { clientX: 100, clientY: 0, durationSeconds: 5, easing: "linear" },
            window,
            {
                screen,
                moveCursor: first.moveCursor,
                cursorAvailable: async () => true,
                now: () => clock,
                sleep: () => new Promise<void>(resolve => pending.push(resolve)),
            },
        );
        // Let the first move take its opening step and park on `sleep`.
        await vi.waitFor(() => expect(pending.length).toBe(1));
        await executeBlueprintPointerMove({ clientX: 0, clientY: 0 }, window, {
            screen,
            moveCursor: second.moveCursor,
            cursorAvailable: async () => true,
        });
        const stepsBefore = first.points.length;
        pending.forEach(resolve => resolve());
        await expect(slowMove).resolves.toEqual({ outcome: "moved" });
        expect(first.points.length).toBe(stepsBefore);
        expect(second.points).toEqual([{ x: 100, y: 200 }]);
    });
});
