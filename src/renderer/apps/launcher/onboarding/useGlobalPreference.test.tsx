// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalPreference } from "./useGlobalPreference";

const fixture = vi.hoisted(() => ({
    read: vi.fn(),
    write: vi.fn(),
    listener: null as null | ((change: { key: string; value: unknown }) => void),
}));

vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({ app: { state: {
    getGlobalState: fixture.read,
    setGlobalState: fixture.write,
    onGlobalStateChanged: (listener: typeof fixture.listener) => {
        fixture.listener = listener;
        return { cancel: () => { fixture.listener = null; } };
    },
} } }) }));

const key = "versionControl.authorName";
const asText = (value: unknown) => typeof value === "string" ? value : "";

beforeEach(() => {
    vi.useFakeTimers();
    fixture.write.mockImplementation(async (writtenKey: string, value: unknown) => {
        fixture.listener?.({ key: writtenKey, value });
        return { success: true };
    });
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    fixture.read.mockReset();
    fixture.write.mockReset();
    fixture.listener = null;
});

describe("first-run preference", () => {
    it("keeps a local edit when the initial read arrives late", async () => {
        let resolve!: (value: unknown) => void;
        fixture.read.mockReturnValue(new Promise(done => { resolve = done; }));
        const { result } = renderHook(() => useGlobalPreference(key, asText, 400));

        act(() => result.current[1]("Ada"));
        await act(async () => { resolve({ success: true, data: { value: "old" } }); });

        expect(result.current[0]).toBe("Ada");
        await act(async () => { vi.advanceTimersByTime(400); });
        expect(fixture.write).toHaveBeenCalledWith(key, "Ada");
    });

    it("keeps a newer draft when an earlier write is broadcast", async () => {
        fixture.read.mockResolvedValue({ success: true, data: { value: "old" } });
        const { result } = renderHook(() => useGlobalPreference(key, asText, 400));
        await act(async () => { await Promise.resolve(); });

        act(() => result.current[1]("Ada"));
        await act(async () => { vi.advanceTimersByTime(400); });
        act(() => result.current[1]("Ada Lovelace"));
        act(() => fixture.listener?.({ key, value: "Ada" }));

        expect(result.current[0]).toBe("Ada Lovelace");
        await act(async () => { vi.advanceTimersByTime(400); });
        expect(fixture.write).toHaveBeenLastCalledWith(key, "Ada Lovelace");
        expect(result.current[0]).toBe("Ada Lovelace");
    });

    it("serialises immediate writes and follows external updates when idle", async () => {
        fixture.read.mockResolvedValue({ success: true, data: { value: "old" } });
        let finishFirst!: () => void;
        fixture.write.mockImplementationOnce(() => new Promise(done => {
            finishFirst = () => done({ success: true });
        }));
        const { result } = renderHook(() => useGlobalPreference(key, asText));
        await act(async () => { await Promise.resolve(); });

        act(() => { result.current[1]("first"); result.current[1]("second"); });
        await act(async () => { await Promise.resolve(); });
        expect(fixture.write).toHaveBeenCalledTimes(1);
        await act(async () => { finishFirst(); });
        expect(fixture.write).toHaveBeenCalledTimes(2);
        expect(result.current[0]).toBe("second");

        act(() => fixture.listener?.({ key, value: "external" }));
        expect(result.current[0]).toBe("external");
    });

    it("flushes a deferred edit when setup closes", async () => {
        fixture.read.mockResolvedValue({ success: true, data: { value: "old" } });
        const { result, unmount } = renderHook(() => useGlobalPreference(key, asText, 400));
        await act(async () => { await Promise.resolve(); });
        act(() => result.current[1]("draft"));
        unmount();
        await act(async () => { await Promise.resolve(); });
        expect(fixture.write).toHaveBeenCalledWith(key, "draft");
    });

    it("shows the confirmed preference again when a write is refused", async () => {
        fixture.read.mockResolvedValue({ success: true, data: { value: "old" } });
        fixture.write.mockResolvedValue({ success: false, error: "write failed" });
        const { result } = renderHook(() => useGlobalPreference(key, asText));
        await act(async () => { await Promise.resolve(); });

        await act(async () => { result.current[1]("new"); });

        expect(result.current[0]).toBe("old");
    });

    it("retains an earlier successful write when a newer write fails without a broadcast", async () => {
        fixture.read.mockResolvedValue({ success: true, data: { value: "old" } });
        let finishFirst!: () => void;
        fixture.write
            .mockImplementationOnce(() => new Promise(done => { finishFirst = () => done({ success: true }); }))
            .mockResolvedValueOnce({ success: false });
        const { result } = renderHook(() => useGlobalPreference(key, asText));
        await act(async () => { await Promise.resolve(); });

        act(() => { result.current[1]("first"); result.current[1]("second"); });
        await act(async () => { await Promise.resolve(); });
        await act(async () => { finishFirst(); });

        expect(result.current[0]).toBe("first");
    });

    it("does not reuse an earlier write's broadcast for a later successful write", async () => {
        fixture.read.mockResolvedValue({ success: true, data: { value: "old" } });
        let finishFirst!: () => void;
        fixture.write
            .mockImplementationOnce(() => new Promise(done => { finishFirst = () => {
                fixture.listener?.({ key, value: "first" });
                done({ success: true });
            }; }))
            .mockResolvedValueOnce({ success: true });
        const { result } = renderHook(() => useGlobalPreference(key, asText));
        await act(async () => { await Promise.resolve(); });

        act(() => { result.current[1]("first"); result.current[1]("second"); });
        await act(async () => { await Promise.resolve(); });
        await act(async () => { finishFirst(); });

        expect(result.current[0]).toBe("second");
    });

    it("does not let a delayed initial read replace a successful write's fallback", async () => {
        let finishRead!: (value: unknown) => void;
        fixture.read.mockReturnValue(new Promise(done => { finishRead = done; }));
        fixture.write.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
        const { result } = renderHook(() => useGlobalPreference(key, asText));

        await act(async () => { result.current[1]("first"); });
        await act(async () => { finishRead({ success: true, data: { value: "old" } }); });
        await act(async () => { result.current[1]("second"); });

        expect(result.current[0]).toBe("first");
    });

    it("uses a delayed initial read after a failed write", async () => {
        let finishRead!: (value: unknown) => void;
        fixture.read.mockReturnValue(new Promise(done => { finishRead = done; }));
        fixture.write.mockResolvedValue({ success: false });
        const { result } = renderHook(() => useGlobalPreference(key, asText));

        await act(async () => { result.current[1]("new"); });
        await act(async () => { finishRead({ success: true, data: { value: "old" } }); });

        expect(result.current[0]).toBe("old");
    });

    it("ignores a delayed read after the preference key changes", async () => {
        const finish: ((value: unknown) => void)[] = [];
        fixture.read.mockImplementation(() => new Promise(done => { finish.push(done); }));
        const { result, rerender } = renderHook(({ preferenceKey }) => useGlobalPreference(preferenceKey, asText), {
            initialProps: { preferenceKey: key as "versionControl.authorName" | "project.defaultAuthor" },
        });
        rerender({ preferenceKey: "project.defaultAuthor" });

        expect(finish).toHaveLength(2);
        await act(async () => { finish[1]({ success: true, data: { value: "new" } }); });
        await act(async () => { finish[0]({ success: true, data: { value: "old" } }); });

        expect(result.current[0]).toBe("new");
    });
});
