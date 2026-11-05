// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFollowedAsset } from "./useFollowedAsset";

/**
 * A preview tab follows its asset's bytes.
 *
 * The image preview read the record it was opened with, so after Replace File… (or a conversion, a
 * PSD refresh, the undo of any of them) it kept drawing the old picture. The record it reads now moves
 * with the library's `updated` announcement for its id - and only for its id.
 */

type Listener = (asset: { id: string; hash: string; name: string }) => void;
const listeners = new Set<Listener>();
const announce = (asset: { id: string; hash: string; name: string }) => listeners.forEach(listener => listener(asset));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({
        context: {
            services: {
                get: () => ({
                    getEvents: () => ({
                        on: (event: string, listener: Listener) => {
                            if (event !== "updated") {
                                return () => undefined;
                            }
                            listeners.add(listener);
                            return () => listeners.delete(listener);
                        },
                    }),
                }),
            },
        },
        isInitialized: true,
    }),
}));

const opened = { id: "room", hash: "hash-old", name: "room.png" } as never;

describe("useFollowedAsset", () => {
    it("starts from the record the tab was opened with", () => {
        const { result } = renderHook(() => useFollowedAsset(opened));
        expect(result.current).toBe(opened);
    });

    it("takes the new hash when the library announces the asset's bytes changed", () => {
        const { result } = renderHook(() => useFollowedAsset(opened));
        act(() => announce({ id: "room", hash: "hash-new", name: "room.jpg" }));
        expect(result.current).toMatchObject({ id: "room", hash: "hash-new", name: "room.jpg" });
    });

    it("ignores every other asset", () => {
        const { result } = renderHook(() => useFollowedAsset(opened));
        act(() => announce({ id: "hall", hash: "hash-new", name: "hall.png" }));
        expect(result.current).toBe(opened);
    });

    it("starts again from a new payload", () => {
        const next = { id: "hall", hash: "hash-hall", name: "hall.png" } as never;
        const hook = renderHook(props => useFollowedAsset(props.asset), { initialProps: { asset: opened } });
        act(() => announce({ id: "room", hash: "hash-new", name: "room.png" }));
        hook.rerender({ asset: next });
        expect(hook.result.current).toBe(next);
    });

    it("stops listening when the tab closes", () => {
        const hook = renderHook(() => useFollowedAsset(opened));
        expect(listeners.size).toBeGreaterThan(0);
        const before = listeners.size;
        hook.unmount();
        expect(listeners.size).toBe(before - 1);
    });
});
