// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "@shared/constants/update";
import { useUpdateState } from "./useUpdateState";

let resolveRead: (result: { success: true; data: { state: UpdateState } }) => void;
let listener: (state: UpdateState) => void;
const cancel = vi.fn();

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ app: { update: {
        getState: () => new Promise(resolve => { resolveRead = resolve; }),
        onStateChanged: (receive: typeof listener) => {
            listener = receive;
            return { cancel };
        },
    } } }),
}));

afterEach(() => cleanup());

describe("update state", () => {
    it("keeps the latest event when the initial answer arrives afterwards", async () => {
        const { result } = renderHook(() => useUpdateState());
        act(() => listener({ status: "ready", currentVersion: "1.0.0", canInstall: true }));
        await act(async () => resolveRead({ success: true, data: { state: { status: "checking", currentVersion: "1.0.0", canInstall: true } } }));
        expect(result.current?.status).toBe("ready");
    });

    it("loads an initial state and removes the listener on unmount", async () => {
        cancel.mockClear();
        const { result, unmount } = renderHook(() => useUpdateState());
        await act(async () => resolveRead({ success: true, data: { state: { status: "available", currentVersion: "1.0.0", canInstall: true } } }));
        expect(result.current?.status).toBe("available");
        unmount();
        expect(cancel).toHaveBeenCalledOnce();
    });
});
