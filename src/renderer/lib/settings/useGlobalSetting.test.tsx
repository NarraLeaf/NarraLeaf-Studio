// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalSetting } from "./useGlobalSetting";

/**
 * The bug this guards against is one an author reports as "the setting did nothing": Settings is a
 * window of its own, and a reader that only re-read on focus left the workspace behind it showing
 * the previous value until that window was closed or clicked away from.
 */

let stored: unknown;
let listeners: Array<(change: { key: string; value: unknown }) => void> = [];
let resolveRead: (() => void) | null = null;

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: {
            state: {
                getGlobalState: async (_key: string) => {
                    if (resolveRead) {
                        await new Promise<void>(resolve => { resolveRead = resolve; });
                    }
                    return { success: true, data: { value: stored } };
                },
                onGlobalStateChanged: (handler: (change: { key: string; value: unknown }) => void) => {
                    listeners.push(handler);
                    return { cancel: () => { listeners = listeners.filter(entry => entry !== handler); } };
                },
            },
        },
    }),
}));

const resolve = (value: unknown): string => (typeof value === "string" ? value : "none");
const broadcast = (change: { key: string; value: unknown }) => {
    act(() => { for (const listener of [...listeners]) { listener(change); } });
};

beforeEach(() => {
    stored = undefined;
    listeners = [];
    resolveRead = null;
});

describe("useGlobalSetting", () => {
    it("resolves an unset key through the reader's default", async () => {
        const { result } = renderHook(() => useGlobalSetting("editor.storyRowHighlight", resolve));
        expect(result.current).toBe("none");
        await waitFor(() => expect(listeners.length).toBe(1));
        expect(result.current).toBe("none");
    });

    it("follows a change broadcast from another window", async () => {
        stored = "script";
        const { result } = renderHook(() => useGlobalSetting("editor.storyRowHighlight", resolve));
        await waitFor(() => expect(result.current).toBe("script"));

        broadcast({ key: "editor.storyRowHighlight", value: "command" });
        expect(result.current).toBe("command");
    });

    it("resolves a reset - which broadcasts undefined - through the default", async () => {
        stored = "command";
        const { result } = renderHook(() => useGlobalSetting("editor.storyRowHighlight", resolve));
        await waitFor(() => expect(result.current).toBe("command"));

        broadcast({ key: "editor.storyRowHighlight", value: undefined });
        expect(result.current).toBe("none");
    });

    it("ignores other keys", async () => {
        stored = "script";
        const { result } = renderHook(() => useGlobalSetting("editor.storyRowHighlight", resolve));
        await waitFor(() => expect(result.current).toBe("script"));

        broadcast({ key: "editor.hideParamNames", value: "command" });
        expect(result.current).toBe("script");
    });

    it("keeps a change that lands while the first read is still in flight", async () => {
        stored = "script";
        resolveRead = () => undefined;
        const { result } = renderHook(() => useGlobalSetting("editor.storyRowHighlight", resolve));
        await waitFor(() => expect(listeners.length).toBe(1));

        broadcast({ key: "editor.storyRowHighlight", value: "command" });
        expect(result.current).toBe("command");

        // The stale read finishes last and must not put the old value back.
        await act(async () => { resolveRead?.(); await Promise.resolve(); });
        expect(result.current).toBe("command");
    });

    it("stops following once unmounted", async () => {
        const { unmount } = renderHook(() => useGlobalSetting("editor.storyRowHighlight", resolve));
        await waitFor(() => expect(listeners.length).toBe(1));
        unmount();
        expect(listeners.length).toBe(0);
    });
});
