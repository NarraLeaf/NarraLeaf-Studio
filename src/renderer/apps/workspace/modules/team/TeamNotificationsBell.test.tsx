// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TeamNotificationsBell } from "./TeamNotificationsBell";

const server = vi.hoisted(() => ({
    account: "account-a",
    reads: [] as Array<(value: unknown) => void>,
    event: undefined as undefined | ((message: { remoteOrigin: string; topic: string }) => void),
}));

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/team", () => ({
    useTeamConnection: () => ({ state: "ready", since: 1, account: { id: server.account } }),
    useTeamCapability: () => true,
    teamCall: () => new Promise(resolve => { server.reads.push(resolve); }),
}));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ team: {
        subscribe: async () => undefined,
        unsubscribe: async () => undefined,
        onEvent: (handler: typeof server.event) => {
            server.event = handler;
            return { cancel: () => { server.event = undefined; } };
        },
    } }),
}));
vi.mock("./TeamProjectContext", () => ({ useTeamProjectSurface: () => ({ remoteOrigin: "team" }) }));
vi.mock("../story-comments/storyCommentsState", () => ({ useStoryCommentsService: () => null, openStoryCommentPopover: vi.fn() }));

beforeEach(() => { server.account = "account-a"; server.reads = []; });
afterEach(cleanup);

it("keeps the newest notification list when an earlier read finishes last", async () => {
    const view = render(<TeamNotificationsBell />);
    expect(server.reads).toHaveLength(1);
    act(() => server.event?.({ remoteOrigin: "team", topic: "account:account-a/notifications" }));
    expect(server.reads).toHaveLength(2);

    await act(async () => { server.reads[1]!({ ok: true, value: { notifications: [], unread: 1 } }); });
    await waitFor(() => expect(view.container.textContent).toContain("1"));
    await act(async () => { server.reads[0]!({ ok: true, value: { notifications: [], unread: 7 } }); });
    expect(view.container.textContent).toContain("1");
    expect(view.container.textContent).not.toContain("7");
});

it("clears the previous account while the new account's notifications load", async () => {
    const view = render(<TeamNotificationsBell />);
    await act(async () => { server.reads[0]!({ ok: true, value: { notifications: [], unread: 7 } }); });
    expect(view.container.textContent).toContain("7");
    server.account = "account-b";
    view.rerender(<TeamNotificationsBell />);
    expect(view.container.textContent).not.toContain("7");
    expect(view.container.querySelector("[data-team-notifications]")?.getAttribute("data-team-notifications")).toBe("read");
});
