// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveCursorBroadcaster, LiveSessionChat } from "./LiveCursorAndChat";

const live = vi.hoisted(() => {
    const listeners = new Set<(value: unknown) => void>();
    const state = {
        tab: { id: "story:scene:s1:c1" },
        view: { phase: "active", self: "me", session: { members: [] } },
        presence: { cursors: [] as unknown[], chat: [] as unknown[] },
        listeners,
        setCursor: vi.fn(),
    };
    const service = {
        getView: () => state.view,
        onChanged: () => () => undefined,
        getPresence: () => state.presence,
        onPresenceChanged: (listener: (value: unknown) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        setCursor: state.setCursor,
        sendChat: vi.fn(),
    };
    return { state, service, context: { services: { get: () => service } } };
});

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../context", () => ({ useWorkspace: () => ({ context: live.context, isInitialized: true }) }));
vi.mock("../../hooks/useUIService", () => ({ useActiveEditorTab: () => ({ tab: live.state.tab }) }));
vi.mock("../agent/revealAgentWrite", () => ({ revealAgentWrite: vi.fn() }));
vi.mock("../story/scene-editor/openStorySceneEditorTab", () => ({ createStorySceneEditorTab: vi.fn() }));

beforeEach(() => {
    live.state.tab = { id: "story:scene:s1:c1" };
    live.state.presence = { cursors: [], chat: [] };
    live.state.setCursor.mockClear();
});

afterEach(() => {
    cleanup();
    live.state.listeners.clear();
});

function line(id: number) {
    return { id: `line-${id}`, instance: "other", account: "other", text: `Message ${id}`, at: id, mine: false };
}

describe("live cursor and chat", () => {
    it("never announces a row from the previous scene when switching tabs", () => {
        const view = render(<LiveCursorBroadcaster />);
        const row = document.createElement("div");
        row.dataset.storyRowBlockId = "row-1";
        document.body.appendChild(row);
        fireEvent.pointerDown(row);
        expect(live.state.setCursor).toHaveBeenLastCalledWith("story:s1", "c1/row-1");

        live.state.setCursor.mockClear();
        live.state.tab = { id: "story:scene:s1:c2" };
        view.rerender(<LiveCursorBroadcaster />);
        expect(live.state.setCursor).not.toHaveBeenCalledWith("story:s1", "c2/row-1");
        expect(live.state.setCursor).toHaveBeenLastCalledWith("story:s1", undefined);
        row.remove();
    });

    it("counts new messages after the retained chat history reaches its limit", () => {
        live.state.presence = { cursors: [], chat: Array.from({ length: 200 }, (_, index) => line(index)) };
        render(<LiveSessionChat />);
        fireEvent.click(screen.getByLabelText("workspace.shell.team.liveChat.open"));
        fireEvent.click(screen.getByLabelText("workspace.shell.team.liveChat.close"));

        act(() => {
            live.state.presence = { cursors: [], chat: Array.from({ length: 200 }, (_, index) => line(index + 1)) };
            for (const listener of live.state.listeners) listener(live.state.presence);
            live.state.presence = { cursors: [], chat: Array.from({ length: 200 }, (_, index) => line(index + 2)) };
            for (const listener of live.state.listeners) listener(live.state.presence);
        });
        expect(screen.getByText("2")).toBeTruthy();
        fireEvent.click(screen.getByLabelText("workspace.shell.team.liveChat.open"));
        fireEvent.click(screen.getByLabelText("workspace.shell.team.liveChat.close"));
        expect(screen.queryByText("2")).toBeNull();
    });
});
