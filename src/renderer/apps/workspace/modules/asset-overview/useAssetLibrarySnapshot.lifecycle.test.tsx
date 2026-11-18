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

const walk: DirectorySizeResult = { totalBytes: 10, fileCount: 1, bytesByRelativePath: {} };
const summary = (id: string) => ({ entries: [{ asset: { id }, bytes: 10, referenced: false, referenceCount: 0, usageKnown: true }] });

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function fakeContext() {
    const listeners = new Set<() => void>();
    const context = {
        services: { get: () => ({ onIndexChanged: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        } }) },
    } as unknown as WorkspaceContext;
    return { context, announce: () => listeners.forEach(listener => listener()) };
}

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
});
afterEach(() => vi.useRealTimers());

describe("useAssetLibrarySnapshot lifecycle", () => {
    it("reads the loaded records against the existing walk when the initial library arrives", async () => {
        const { context } = fakeContext();
        compute.mockResolvedValueOnce({ summary: summary("before-load"), walk })
            .mockResolvedValueOnce({ summary: summary("loaded"), walk });
        const { result, rerender } = renderHook(({ key }) => useAssetLibrarySnapshot(context, true, key), {
            initialProps: { key: undefined as string | undefined },
        });
        await settle();

        rerender({ key: "loaded:hash" });
        await settle();

        expect(compute).toHaveBeenCalledTimes(2);
        expect(compute.mock.calls[1][1]).toBe(walk);
        expect(result.current.snapshot?.entries[0].asset.id).toBe("loaded");
    });

    it("rereads loaded records once an in-flight initial walk has completed", async () => {
        const { context } = fakeContext();
        const pending = deferred<{ summary: ReturnType<typeof summary>; walk: DirectorySizeResult }>();
        compute.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ summary: summary("loaded"), walk });
        const { result, rerender } = renderHook(({ key }) => useAssetLibrarySnapshot(context, true, key), {
            initialProps: { key: undefined as string | undefined },
        });
        rerender({ key: "loaded:hash" });
        await act(async () => pending.resolve({ summary: summary("before-load"), walk }));
        await settle();

        expect(compute).toHaveBeenCalledTimes(2);
        expect(compute.mock.calls[1][1]).toBe(walk);
        expect(result.current.snapshot?.entries[0].asset.id).toBe("loaded");
    });

    it("cancels queued updates and publication when switched off during a read", async () => {
        const { context, announce } = fakeContext();
        const pending = deferred<{ summary: ReturnType<typeof summary>; walk: DirectorySizeResult }>();
        compute.mockReturnValueOnce(pending.promise).mockResolvedValue({ summary: summary("extra"), walk });
        const { result, rerender } = renderHook(({ enabled }) => useAssetLibrarySnapshot(context, enabled, "a:hash"), {
            initialProps: { enabled: true },
        });
        act(() => announce());
        rerender({ enabled: false });
        await act(async () => pending.resolve({ summary: summary("late"), walk }));
        await settle();

        expect(compute).toHaveBeenCalledTimes(1);
        expect(result.current.snapshot).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it("retains the last completed reading while switched off", async () => {
        const { context } = fakeContext();
        compute.mockResolvedValueOnce({ summary: summary("kept"), walk });
        const { result, rerender } = renderHook(({ enabled }) => useAssetLibrarySnapshot(context, enabled, "a:hash"), {
            initialProps: { enabled: true },
        });
        await settle();
        rerender({ enabled: false });

        expect(result.current.snapshot?.entries[0].asset.id).toBe("kept");
        expect(result.current.loading).toBe(false);
    });

    it("does not show a previous workspace's snapshot while a new workspace is loading", async () => {
        const first = fakeContext().context;
        const second = fakeContext().context;
        const pending = deferred<{ summary: ReturnType<typeof summary>; walk: DirectorySizeResult }>();
        compute.mockResolvedValueOnce({ summary: summary("first"), walk }).mockReturnValueOnce(pending.promise);
        const { result, rerender } = renderHook(({ context }) => useAssetLibrarySnapshot(context, true, "a:hash"), {
            initialProps: { context: first },
        });
        await settle();
        expect(result.current.snapshot?.entries[0].asset.id).toBe("first");

        rerender({ context: second });
        expect(result.current.snapshot).toBeNull();
        expect(result.current.bytesByAssetId).toBeNull();
        await act(async () => pending.resolve({ summary: summary("second"), walk }));
        await settle();
        expect(result.current.snapshot?.entries[0].asset.id).toBe("second");
    });

    it("discards a previous workspace's late result and measures the new workspace", async () => {
        const first = fakeContext().context;
        const second = fakeContext().context;
        const pending = deferred<{ summary: ReturnType<typeof summary>; walk: DirectorySizeResult }>();
        compute.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ summary: summary("second"), walk });
        const { result, rerender } = renderHook(({ context }) => useAssetLibrarySnapshot(context, true, "a:hash"), {
            initialProps: { context: first },
        });
        rerender({ context: second });
        await settle();
        await act(async () => pending.resolve({ summary: summary("first"), walk }));
        await settle();

        expect(compute).toHaveBeenCalledTimes(2);
        expect(compute.mock.calls[1][1]).toBeUndefined();
        expect(result.current.snapshot?.entries[0].asset.id).toBe("second");
    });

    it("does not reuse the old workspace's walk after the new workspace fails", async () => {
        const first = fakeContext();
        const second = fakeContext();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        compute.mockResolvedValueOnce({ summary: summary("first"), walk })
            .mockRejectedValueOnce(new Error("read failed"))
            .mockResolvedValueOnce({ summary: summary("second"), walk });
        const { result, rerender } = renderHook(({ context }) => useAssetLibrarySnapshot(context, true, "a:hash"), {
            initialProps: { context: first.context },
        });
        await settle();
        rerender({ context: second.context });
        await settle();
        expect(result.current.failed).toBe(true);
        expect(result.current.snapshot).toBeNull();

        act(() => second.announce());
        await settle();
        expect(compute.mock.calls[2][1]).toBeUndefined();
        expect(result.current.snapshot?.entries[0].asset.id).toBe("second");
        warn.mockRestore();
    });
});
