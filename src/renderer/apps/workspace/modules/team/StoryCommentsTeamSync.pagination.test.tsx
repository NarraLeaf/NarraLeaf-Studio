// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { StoryCommentsTeamSyncMount } from "./StoryCommentsTeamSync";

const fixture = vi.hoisted(() => ({
    requests: [] as unknown[],
    failSecondPage: false,
    malformedSecondPage: false,
    malformedCursor: false,
    wrongThread: false,
    localPending: false,
    writes: [] as string[],
    applied: vi.fn(),
}));

vi.mock("@/lib/team", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTeamCapability: () => true,
    useTeamConnection: () => ({ state: "ready", since: 1 }),
}));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ team: {
        call: async (_origin: string, method: string, params: { after?: string }) => {
            const thread = {
                id: "t1", project: "p1", anchor: { document: "story:story", element: "scene/row" },
                kind: "comment", status: "open", createdAt: 1, updatedAt: 1, comments: 2,
            };
            if (method === "threads.list") return { success: true, data: { ok: true, value: { threads: [thread] } } };
            if (method === "threads.get") {
                fixture.requests.push(params);
                if (params.after === undefined) {
                    return { success: true, data: { ok: true, value: {
                        thread,
                        comments: [{ id: "c1", thread: "t1", body: "first", createdAt: 1 }],
                        cursor: fixture.malformedCursor ? 2 : "next-page",
                    } } };
                }
                if (fixture.failSecondPage) return { success: true, data: { ok: false, problem: { kind: "offline" } } };
                if (fixture.malformedSecondPage) return { success: true, data: { ok: true, value: { thread, comments: null } } };
                return { success: true, data: { ok: true, value: { thread, comments: [{ id: "c2", thread: fixture.wrongThread ? "other" : "t1", body: "second", createdAt: 2 }] } } };
            }
            if (method === "threads.create") {
                fixture.writes.push(method);
                return { success: true, data: { ok: false, problem: { kind: "offline" } } };
            }
            throw new Error(`Unexpected Team method: ${method}`);
        },
        subscribe: async () => undefined,
        unsubscribe: async () => undefined,
        onEvent: () => ({ cancel: () => undefined }),
    } }),
}));
vi.mock("../story-comments/storyCommentsState", () => ({
    useStoryCommentsService: () => ({
        onChanged: () => () => undefined,
        listThreads: () => fixture.localPending ? [{
            id: "local", storyId: "story", sceneId: "scene", blockId: "row", todo: false,
            resolved: false, createdAt: 1, comments: [{ id: "local-comment", body: "local", author: { name: "Ada" }, createdAt: 1 }],
        }] : [],
        applyRemoteThread: fixture.applied,
    }),
}));
vi.mock("./TeamProjectContext", () => ({
    useTeamProjectSurface: () => ({ remoteOrigin: "team", state: { kind: "verified", project: { id: "p1" } } }),
}));

beforeEach(() => {
    fixture.requests.length = 0;
    fixture.failSecondPage = false;
    fixture.malformedSecondPage = false;
    fixture.malformedCursor = false;
    fixture.wrongThread = false;
    fixture.localPending = false;
    fixture.writes.length = 0;
    fixture.applied.mockClear();
});
afterEach(cleanup);

it("passes each comment cursor through the mounted Team transport", async () => {
    render(<StoryCommentsTeamSyncMount />);

    await waitFor(() => expect(fixture.applied).toHaveBeenCalledTimes(1));
    expect(fixture.requests).toEqual([
        { thread: "t1", limit: 200 },
        { thread: "t1", limit: 200, after: "next-page" },
    ]);
    expect(fixture.applied.mock.calls[0][0].comments.map((comment: { body: string }) => comment.body)).toEqual(["first", "second"]);
});

it("leaves the local snapshot untouched if a later Team page fails", async () => {
    fixture.failSecondPage = true;
    fixture.localPending = true;
    render(<StoryCommentsTeamSyncMount />);

    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    await waitFor(() => expect(fixture.writes).toEqual([]));
    expect(fixture.applied).not.toHaveBeenCalled();
});

it("leaves the local snapshot untouched if a later Team page is unreadable", async () => {
    fixture.malformedSecondPage = true;
    render(<StoryCommentsTeamSyncMount />);

    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(fixture.applied).not.toHaveBeenCalled();
});

it("leaves the local snapshot untouched if a cursor is unreadable", async () => {
    fixture.malformedCursor = true;
    render(<StoryCommentsTeamSyncMount />);

    await waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(fixture.applied).not.toHaveBeenCalled();
});

it("leaves the local snapshot untouched if a page contains another thread's comment", async () => {
    fixture.wrongThread = true;
    render(<StoryCommentsTeamSyncMount />);

    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(fixture.applied).not.toHaveBeenCalled();
});
