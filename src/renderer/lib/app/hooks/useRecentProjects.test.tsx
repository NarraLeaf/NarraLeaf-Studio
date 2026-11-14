// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecentProjectIcons, useRecentProjects } from "./useRecentProjects";

type Project = { name: string; path: string; openedAt: number };
type Icon = { path: string; icon: string };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

let recentRead: ReturnType<typeof deferred<{ success: true; data: { value: Project[] } }>>;
let iconReads: Array<ReturnType<typeof deferred<{ success: true; data: { icons: Icon[] } }>>>;
let listeners: Set<(change: { key: string; value: unknown }) => void>;

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: {
            state: {
                getGlobalState: () => recentRead.promise,
                onGlobalStateChanged: (listener: (change: { key: string; value: unknown }) => void) => {
                    listeners.add(listener);
                    return { cancel: () => listeners.delete(listener) };
                },
            },
            recentProjectIcons: () => {
                const read = deferred<{ success: true; data: { icons: Icon[] } }>();
                iconReads.push(read);
                return read.promise;
            },
        },
    }),
}));

function broadcast(key: string, value: unknown) {
    act(() => { for (const listener of listeners) listener({ key, value }); });
}

beforeEach(() => {
    recentRead = deferred();
    iconReads = [];
    listeners = new Set();
});

afterEach(() => cleanup());

describe("recent projects", () => {
    it("shows the initial answer when no project change has arrived", async () => {
        const { result } = renderHook(() => useRecentProjects());
        const projects = [{ name: "First", path: "/first", openedAt: 1 }];
        broadcast("unrelated", []);
        await act(async () => { recentRead.resolve({ success: true, data: { value: projects } }); });
        expect(result.current).toEqual(projects);
    });

    it("keeps a broadcast that arrives before the initial answer", async () => {
        const { result } = renderHook(() => useRecentProjects());
        const oldProjects = [{ name: "Old", path: "/old", openedAt: 1 }];
        const newProjects = [{ name: "New", path: "/new", openedAt: 2 }];
        broadcast("app.recentProjects", newProjects);
        await act(async () => { recentRead.resolve({ success: true, data: { value: oldProjects } }); });
        expect(result.current).toEqual(newProjects);
    });

    it("removes its subscription when the surface unmounts", () => {
        const { unmount } = renderHook(() => useRecentProjects());
        expect(listeners.size).toBe(1);
        unmount();
        expect(listeners.size).toBe(0);
    });
});

describe("recent project icons", () => {
    it("keeps the newest refresh when an older read finishes last", async () => {
        const { result } = renderHook(() => useRecentProjectIcons());
        act(() => window.dispatchEvent(new Event("focus")));
        expect(iconReads).toHaveLength(2);
        await act(async () => { iconReads[1].resolve({ success: true, data: { icons: [{ path: "/project", icon: "new" }] } }); });
        await act(async () => { iconReads[0].resolve({ success: true, data: { icons: [{ path: "/project", icon: "old" }] } }); });
        expect(result.current.get("/project")).toBe("new");
    });
});
