// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWindowFullscreen } from "./useWindowFullscreen";

let resolveRead: (result: { success: true; data: { isFullscreen: boolean } }) => void;
let listener: (event: { isFullscreen: boolean }) => void;
const cancel = vi.fn();

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ window: { control: {
        getFullscreen: () => new Promise(resolve => { resolveRead = resolve; }),
        onFullscreenChanged: (receive: typeof listener) => {
            listener = receive;
            return { cancel };
        },
    } } }),
}));

afterEach(() => cleanup());

describe("window fullscreen state", () => {
    it("keeps the latest event when the initial answer arrives afterwards", async () => {
        const { result } = renderHook(() => useWindowFullscreen());
        act(() => listener({ isFullscreen: true }));
        await act(async () => resolveRead({ success: true, data: { isFullscreen: false } }));
        expect(result.current).toBe(true);
    });

    it("loads an initial value and removes the listener on unmount", async () => {
        cancel.mockClear();
        const { result, unmount } = renderHook(() => useWindowFullscreen());
        await act(async () => resolveRead({ success: true, data: { isFullscreen: true } }));
        expect(result.current).toBe(true);
        unmount();
        expect(cancel).toHaveBeenCalledOnce();
    });
});
