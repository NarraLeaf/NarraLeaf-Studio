// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAVORITES_SETTING_KEY } from "./storyActionCreatorFavorites";
import { useStarredStoryCommands } from "./useStarredStoryCommands";

/**
 * The starred set two surfaces share: the command manual and the `/` menu. Either one writes, the
 * store echoes the write to every reader, and neither may lose a star the other just set.
 */

let stored: unknown;
let listeners: Array<(change: { key: string; value: unknown }) => void> = [];
let writes: unknown[] = [];
let failWrites = false;
/** The settings service's cache, when a test runs inside a workspace. */
let cache: Record<string, unknown> | null = null;

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: {
            state: {
                getGlobalState: async (_key: string) => ({ success: true, data: { value: stored } }),
                setGlobalState: async (_key: string, value: unknown) => {
                    writes.push(value);
                    return failWrites ? { success: false, error: "disk full" } : { success: true, data: undefined };
                },
                onGlobalStateChanged: (handler: (change: { key: string; value: unknown }) => void) => {
                    listeners.push(handler);
                    return { cancel: () => { listeners = listeners.filter(entry => entry !== handler); } };
                },
            },
        },
    }),
}));

/** One workspace for the whole file, as the real one is one object for the window's lifetime. */
const settingsService = {
    has: (key: string) => cache !== null && key in cache,
    getSync: (key: string) => cache?.[key],
};
const workspace = { isInitialized: true, context: { services: { get: () => settingsService } } };

vi.mock("@/apps/workspace/context", () => ({
    useOptionalWorkspace: () => cache === null ? null : workspace,
}));

const broadcast = (value: unknown) => {
    act(() => {
        for (const listener of [...listeners]) {
            listener({ key: FAVORITES_SETTING_KEY, value });
        }
    });
};

const ids = (set: ReadonlySet<string>) => [...set];

beforeEach(() => {
    stored = undefined;
    listeners = [];
    writes = [];
    failWrites = false;
    cache = null;
});

describe("useStarredStoryCommands", () => {
    it("starts from the settings cache on its first frame, inside a workspace", () => {
        // The `/` menu mounts a reader per line; an empty first frame would park the highlight on a
        // subject row and leave it there when the starred rows arrived above it.
        cache = { [FAVORITES_SETTING_KEY]: ["show", "set"] };
        const { result } = renderHook(() => useStarredStoryCommands());
        expect(ids(result.current.starredIds)).toEqual(["show", "set"]);
    });

    it("reads the store when there is no workspace cache", async () => {
        stored = ["volume"];
        const { result } = renderHook(() => useStarredStoryCommands());
        await waitFor(() => expect(ids(result.current.starredIds)).toEqual(["volume"]));
    });

    it("migrates legacy ids on the way in", () => {
        cache = { [FAVORITES_SETTING_KEY]: ["imageShow", "textShow", "setVariable"] };
        const { result } = renderHook(() => useStarredStoryCommands());
        expect(ids(result.current.starredIds)).toEqual(["show", "set"]);
    });

    it("keeps both of two stars set before the first write is echoed", async () => {
        cache = { [FAVORITES_SETTING_KEY]: [] };
        const { result } = renderHook(() => useStarredStoryCommands());
        act(() => {
            result.current.toggleStarred("show");
            result.current.toggleStarred("volume");
        });
        expect(ids(result.current.starredIds)).toEqual(["show", "volume"]);
        await waitFor(() => expect(writes).toHaveLength(2));
        expect(writes[1]).toEqual(["show", "volume"]);
    });

    it("follows a change made by another reader", () => {
        cache = { [FAVORITES_SETTING_KEY]: ["show"] };
        const { result } = renderHook(() => useStarredStoryCommands());
        broadcast(["show", "bgm"]);
        expect(ids(result.current.starredIds)).toEqual(["show", "bgm"]);
    });

    it("keeps the same set when the echo matches what is already shown", () => {
        cache = { [FAVORITES_SETTING_KEY]: ["show"] };
        const { result } = renderHook(() => useStarredStoryCommands());
        const before = result.current.starredIds;
        broadcast(["show"]);
        expect(result.current.starredIds).toBe(before);
    });

    it("puts the star back when the write is refused", async () => {
        cache = { [FAVORITES_SETTING_KEY]: ["show"] };
        failWrites = true;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { result } = renderHook(() => useStarredStoryCommands());
        act(() => {
            result.current.toggleStarred("show");
        });
        expect(ids(result.current.starredIds)).toEqual([]);
        await waitFor(() => expect(ids(result.current.starredIds)).toEqual(["show"]));
        warn.mockRestore();
    });
});
