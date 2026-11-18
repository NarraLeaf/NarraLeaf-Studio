// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { StoryCommentsTeamSyncMount } from "./StoryCommentsTeamSync";

const fixture = vi.hoisted(() => {
    const thread = {
        id: "local-thread", storyId: "story", sceneId: "scene", blockId: "row", todo: false,
        resolved: false, createdAt: 1, comments: [{ id: "local-comment", body: "Hello", author: { name: "Ada" }, createdAt: 1 }],
    };
    return {
        thread,
        changed: undefined as (() => void) | undefined,
        resolveList: undefined as undefined | ((value: unknown) => void),
        event: undefined as undefined | ((message: { remoteOrigin: string; topic: string; payload: unknown }) => void),
        listCalls: 0,
        writes: [] as string[],
        synced: vi.fn(),
    };
});

vi.mock("@/lib/team", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTeamCapability: () => true,
    useTeamConnection: () => ({ state: "ready", since: 1 }),
}));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ team: {
        call: async (_origin: string, method: string) => {
            if (method === "threads.list") {
                fixture.listCalls += 1;
                const data = await new Promise(resolve => { fixture.resolveList = resolve; });
                return { success: true, data };
            }
            if (method === "threads.create") {
                fixture.writes.push(method);
                return {
                    success: true,
                    data: {
                        ok: true,
                        value: {
                            thread: { id: "remote-thread", project: "p1", anchor: { document: "story:story", element: "scene/row" }, kind: "comment", status: "open", createdAt: 1, updatedAt: 1, comments: 1 },
                            comment: { id: "remote-comment", thread: "remote-thread", author: "ada", body: "Hello", createdAt: 1 },
                        },
                    },
                };
            }
            throw new Error(`Unexpected Team method: ${method}`);
        },
        subscribe: async () => undefined,
        unsubscribe: async () => undefined,
        onEvent: (handler: typeof fixture.event) => { fixture.event = handler; return { cancel: () => { fixture.event = undefined; } }; },
    } }),
}));
vi.mock("../story-comments/storyCommentsState", () => ({
    useStoryCommentsService: () => ({
        onChanged: (handler: () => void) => { fixture.changed = handler; return () => { fixture.changed = undefined; }; },
        listThreads: () => [fixture.thread],
        markSynced: fixture.synced,
    }),
}));
vi.mock("./TeamProjectContext", () => ({
    useTeamProjectSurface: () => ({ remoteOrigin: "team", state: { kind: "verified", project: { id: "p1" } } }),
}));

beforeEach(() => {
    fixture.resolveList = undefined;
    fixture.event = undefined;
    fixture.listCalls = 0;
    fixture.writes.length = 0;
    fixture.synced.mockClear();
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

it("starts the real comment sync push after the initial transport read", async () => {
    render(<StoryCommentsTeamSyncMount />);
    expect(fixture.resolveList).toBeDefined();
    act(() => fixture.changed?.());
    expect(fixture.writes).toEqual([]);
    await act(async () => { fixture.resolveList?.({ ok: true, value: { threads: [] } }); });
    await waitFor(() => expect(fixture.synced).toHaveBeenCalledTimes(1));
    expect(fixture.writes).toEqual(["threads.create"]);
});

it("does not push local comments when the initial list read fails", async () => {
    render(<StoryCommentsTeamSyncMount />);
    act(() => fixture.changed?.());

    await act(async () => { fixture.resolveList?.({ ok: false, problem: { kind: "offline" } }); });

    expect(fixture.writes).toEqual([]);
    expect(fixture.synced).not.toHaveBeenCalled();
});

it("does not push local comments when a later list page fails", async () => {
    render(<StoryCommentsTeamSyncMount />);

    await act(async () => { fixture.resolveList?.({ ok: true, value: { threads: [], cursor: "next" } }); });
    expect(fixture.listCalls).toBe(2);
    await act(async () => { fixture.resolveList?.({ ok: false, problem: { kind: "offline" } }); });

    expect(fixture.writes).toEqual([]);
});

it("does not treat an unreadable list as an empty server", async () => {
    render(<StoryCommentsTeamSyncMount />);

    await act(async () => { fixture.resolveList?.({ ok: true, value: { threads: null } }); });

    expect(fixture.writes).toEqual([]);
});

it("retries after a later local edit and pushes only after a successful read", async () => {
    vi.useFakeTimers();
    render(<StoryCommentsTeamSyncMount />);
    await act(async () => { fixture.resolveList?.({ ok: false, problem: { kind: "offline" } }); });
    expect(fixture.writes).toEqual([]);

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fixture.listCalls).toBe(1);
    act(() => fixture.changed?.());
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(fixture.listCalls).toBe(2);
    expect(fixture.writes).toEqual([]);
    await act(async () => { fixture.resolveList?.({ ok: true, value: { threads: [] } }); });

    expect(fixture.writes).toEqual(["threads.create"]);
    expect(fixture.synced).toHaveBeenCalledTimes(1);
});

it("rechecks the list when a server event arrives during the initial read", async () => {
    render(<StoryCommentsTeamSyncMount />);
    act(() => fixture.event?.({ remoteOrigin: "team", topic: "project:p1/threads", payload: { thread: "remote-thread" } }));

    await act(async () => { fixture.resolveList?.({ ok: true, value: { threads: [] } }); });
    expect(fixture.listCalls).toBe(2);
    expect(fixture.writes).toEqual([]);
    await act(async () => { fixture.resolveList?.({ ok: true, value: { threads: [] } }); });

    expect(fixture.writes).toEqual(["threads.create"]);
});

it("retries a failed initial read on a later server event", async () => {
    render(<StoryCommentsTeamSyncMount />);
    await act(async () => { fixture.resolveList?.({ ok: false, problem: { kind: "offline" } }); });

    act(() => fixture.event?.({ remoteOrigin: "team", topic: "project:p1/threads", payload: { thread: "remote-thread" } }));
    expect(fixture.listCalls).toBe(2);
    expect(fixture.writes).toEqual([]);
    await act(async () => { fixture.resolveList?.({ ok: true, value: { threads: [] } }); });

    expect(fixture.writes).toEqual(["threads.create"]);
});
