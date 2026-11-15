// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { TeamEditingNotice } from "./TeamEditingNotice";

const team = vi.hoisted(() => ({ clients: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/i18n", () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, string>) => key.endsWith(".minutes") ? `${values?.minutes} minutes` : key.endsWith(".here") ? values?.since : key,
    }),
}));
vi.mock("../../hooks/useUIService", () => ({ useActiveEditorTab: () => ({ tab: { id: "story:flow:s1" } }) }));
vi.mock("./TeamProjectContext", () => ({ useTeamProjectSurface: () => ({ clients: team.clients, instance: "me" }) }));

afterEach(() => {
    cleanup();
    team.clients = [];
    vi.useRealTimers();
});

it("uses the current time when another editor first appears", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const view = render(<TeamEditingNotice />);
    vi.setSystemTime(new Date("2026-01-01T12:30:00Z"));
    team.clients = [{ id: "other", account: "bob", editing: "story:s1", editingSince: Date.now() - 10 * 60_000 }];
    view.rerender(<TeamEditingNotice />);
    expect(screen.getByText("10 minutes")).toBeTruthy();
});
