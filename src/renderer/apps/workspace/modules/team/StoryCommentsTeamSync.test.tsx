// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { StoryCommentsTeamSyncMount } from "./StoryCommentsTeamSync";

const sync = vi.hoisted(() => {
    const state = {
        pull: Promise.resolve(true) as Promise<boolean>,
        push: vi.fn(async () => undefined),
        stop: vi.fn(),
        changed: undefined as (() => void) | undefined,
        event: undefined as undefined | ((message: { remoteOrigin: string; topic: string; payload: unknown }) => void),
        pullThread: vi.fn(async (_thread: string): Promise<boolean> => true),
    };
    return state;
});

vi.mock("@/lib/workspace/services/storyComments/storyCommentsTeamSync", () => ({
    StoryCommentsTeamSync: class {
        pullAll() { return sync.pull; }
        pullThread(thread: string) { return sync.pullThread(thread); }
        push() { return sync.push(); }
        stop() { sync.stop(); }
    },
}));
vi.mock("@/lib/team", () => ({
    teamCall: vi.fn(),
    readThread: vi.fn(),
    useTeamCapability: () => true,
    useTeamConnection: () => ({ state: "ready", since: 1 }),
}));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        team: {
            subscribe: async () => undefined,
            unsubscribe: async () => undefined,
            onEvent: (handler: typeof sync.event) => { sync.event = handler; return { cancel: vi.fn() }; },
        },
    }),
}));
vi.mock("../story-comments/storyCommentsState", () => ({
    useStoryCommentsService: () => ({
        onChanged: (handler: () => void) => {
            sync.changed = handler;
            return () => { sync.changed = undefined; };
        },
    }),
}));
vi.mock("./TeamProjectContext", () => ({
    useTeamProjectSurface: () => ({ remoteOrigin: "team", state: { kind: "verified", project: { id: "p1" } } }),
}));

beforeEach(() => {
    vi.useFakeTimers();
    sync.push.mockClear();
    sync.stop.mockClear();
    sync.pullThread.mockReset();
    sync.pullThread.mockResolvedValue(true);
    sync.event = undefined;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

it("waits for the initial pull before sending changes made while it is pending", async () => {
    let finishPull!: (complete: boolean) => void;
    sync.pull = new Promise(resolve => { finishPull = resolve; });
    render(<StoryCommentsTeamSyncMount />);

    act(() => {
        sync.changed?.();
        vi.advanceTimersByTime(800);
    });
    expect(sync.push).not.toHaveBeenCalled();

    await act(async () => { finishPull(true); await sync.pull; });
    expect(sync.push).toHaveBeenCalledTimes(1);
});

it("does not start a push after the mount has been removed", async () => {
    let finishPull!: (complete: boolean) => void;
    sync.pull = new Promise(resolve => { finishPull = resolve; });
    const view = render(<StoryCommentsTeamSyncMount />);
    act(() => { sync.changed?.(); vi.advanceTimersByTime(800); });
    view.unmount();
    await act(async () => { finishPull(true); await sync.pull; });
    expect(sync.stop).toHaveBeenCalledTimes(1);
    expect(sync.push).not.toHaveBeenCalled();
});

it("waits for an event-triggered thread read before pushing edits", async () => {
    sync.pull = Promise.resolve(true);
    let finishThread!: (complete: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finishThread = resolve; });
    sync.pullThread.mockReturnValueOnce(pending);
    render(<StoryCommentsTeamSyncMount />);
    await act(async () => { await sync.pull; });
    expect(sync.push).toHaveBeenCalledTimes(1);

    act(() => sync.event?.({ remoteOrigin: "team", topic: "project:p1/threads", payload: { thread: "t1" } }));
    act(() => { sync.changed?.(); vi.advanceTimersByTime(800); });
    expect(sync.push).toHaveBeenCalledTimes(1);
    await act(async () => { finishThread(true); await pending; });

    expect(sync.push).toHaveBeenCalledTimes(2);
});

it("rechecks the full list after an event-triggered thread read fails", async () => {
    sync.pull = Promise.resolve(true);
    let finishThread!: (complete: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finishThread = resolve; });
    sync.pullThread.mockReturnValueOnce(pending);
    render(<StoryCommentsTeamSyncMount />);
    await act(async () => { await sync.pull; });

    let finishAll!: (complete: boolean) => void;
    sync.pull = new Promise<boolean>(resolve => { finishAll = resolve; });
    act(() => sync.event?.({ remoteOrigin: "team", topic: "project:p1/threads", payload: { thread: "t1" } }));
    act(() => { sync.changed?.(); vi.advanceTimersByTime(800); });
    await act(async () => { finishThread(false); await pending; });
    expect(sync.push).toHaveBeenCalledTimes(1);
    await act(async () => { finishAll(true); await sync.pull; });

    expect(sync.push).toHaveBeenCalledTimes(2);
});
