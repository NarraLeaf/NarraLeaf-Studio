// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import type { DirectorySizeResult } from "@shared/utils/fs";

const compute = vi.fn();
vi.mock("./assetOverviewSnapshot", () => ({
    computeAssetOverviewSnapshot: (...args: unknown[]) => compute(...args),
}));

import { useAssetLibrarySnapshot } from "./useAssetLibrarySnapshot";

const WALK: DirectorySizeResult = { totalBytes: 10, fileCount: 1, bytesByRelativePath: {} };

/** A workspace with only the one service the hook asks for: the index, whose change it follows. */
function fakeContext() {
    const listeners = new Set<() => void>();
    const context = {
        services: {
            get: () => ({
                onIndexChanged: (listener: () => void) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
            }),
        },
    } as unknown as WorkspaceContext;
    return { context, announce: () => listeners.forEach(listener => listener()) };
}

/** Whether each computation was handed a folder measurement to reuse, in call order. */
const reusedWalks = () => compute.mock.calls.map(call => call[1] !== undefined);

async function settle() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    compute.mockReset();
    compute.mockImplementation(async () => ({ summary: { entries: [] }, walk: WALK }));
});

afterEach(() => {
    vi.useRealTimers();
});

describe("useAssetLibrarySnapshot", () => {
    it("measures the folder once when switched on", async () => {
        const { context } = fakeContext();
        renderHook(() => useAssetLibrarySnapshot(context, true, "a:1"));
        await settle();

        expect(reusedWalks()).toEqual([false]);
    });

    it("follows the reference index against the measurement it already holds", async () => {
        const { context, announce } = fakeContext();
        renderHook(() => useAssetLibrarySnapshot(context, true, "a:1"));
        await settle();

        act(() => announce());
        await settle();

        expect(reusedWalks()).toEqual([false, true]);
        expect(compute.mock.calls[1][1]).toBe(WALK);
    });

    it("measures the folder again once the library has settled after a change", async () => {
        const { context } = fakeContext();
        const { rerender } = renderHook(({ key }) => useAssetLibrarySnapshot(context, true, key), {
            initialProps: { key: "a:1" },
        });
        await settle();

        // An import arrives as a run of records; only the end of the run is measured.
        rerender({ key: "a:1|b:2" });
        rerender({ key: "a:1|b:2|c:3" });
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        await settle();

        expect(reusedWalks()).toEqual([false, false]);
    });

    it("does not measure again for the library loading after the first walk", async () => {
        const { context } = fakeContext();
        const { rerender } = renderHook(({ key }) => useAssetLibrarySnapshot(context, true, key), {
            initialProps: { key: undefined as string | undefined },
        });
        await settle();

        rerender({ key: "a:1" });
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        await settle();

        expect(reusedWalks()).toEqual([false]);
    });

    it("walks once when switched back on after the library changed while it was off", async () => {
        const { context } = fakeContext();
        const { rerender } = renderHook(({ on, key }) => useAssetLibrarySnapshot(context, on, key), {
            initialProps: { on: true, key: "a:1" },
        });
        await settle();

        rerender({ on: false, key: "a:1" });
        rerender({ on: false, key: "a:1|b:2" });
        rerender({ on: true, key: "a:1|b:2" });
        await settle();
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        await settle();

        expect(reusedWalks()).toEqual([false, false]);
    });

    it("reads nothing while it is switched off", async () => {
        const { context, announce } = fakeContext();
        renderHook(() => useAssetLibrarySnapshot(context, false, "a:1"));
        act(() => announce());
        await settle();

        expect(compute).not.toHaveBeenCalled();
    });
});
