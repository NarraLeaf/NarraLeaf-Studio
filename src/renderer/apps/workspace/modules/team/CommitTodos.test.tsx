// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamTodo } from "@shared/types/team";

import { CommitTodoPicker, useCommitTodos, type CommitTodos } from "./CommitTodos";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, has: () => false, tn: (key: string) => key, locale: "en" }),
}));

const server = vi.hoisted(() => ({
    todos: [] as TeamTodo[],
    calls: [] as { method: string; params: Record<string, unknown> }[],
    refuse: new Set<string>(),
}));

vi.mock("@/lib/team", () => ({
    useTeamConnection: () => ({ state: "ready", since: 1, capabilities: ["todos"], account: { id: "a1", username: "ada" } }),
    useTeamCapability: () => true,
    teamCall: async (_origin: string, method: string, params: Record<string, unknown>) => {
        server.calls.push({ method, params });
        if (method === "todos.list") return { ok: true, value: { todos: server.todos } };
        if (server.refuse.has(params.todo as string)) return { ok: false, error: { code: "refused" } };
        return { ok: true, value: {} };
    },
}));

vi.mock("./TeamProjectContext", () => ({
    useTeamProjectSurface: () => ({
        remoteOrigin: "https://team.example:41402",
        state: { kind: "verified", project: { id: "p1", name: "harbour", description: "" } },
    }),
}));

function todo(id: string, fields: Partial<TeamTodo>): TeamTodo {
    return { id, owner: "bob", title: id, status: "open", visibility: "project", project: "p1", createdAt: 1, updatedAt: 1, ...fields };
}

let controller: CommitTodos;
function Harness() {
    controller = useCommitTodos();
    return <CommitTodoPicker controller={controller} disabled={false} />;
}

afterEach(() => {
    cleanup();
    server.calls = [];
    server.refuse.clear();
});

describe("the to-dos a commit can finish", () => {
    it("offers the open ones that are the author's to do, and nothing else", async () => {
        server.todos = [
            todo("given-to-me", { assignee: "ada" }),
            todo("mine-unassigned", { owner: "ada" }),
            todo("mine-given-away", { owner: "ada", assignee: "bob" }),
            todo("somebody-elses", {}),
            todo("already-done", { assignee: "ada", status: "done" }),
        ];
        const view = render(<Harness />);
        await waitFor(() => expect(view.container.querySelectorAll("li")).toHaveLength(2));
        expect(controller.todos.map(t => t.id)).toEqual(["given-to-me", "mine-unassigned"]);
        expect(server.calls[0]).toEqual({ method: "todos.list", params: { project: "p1" } });
    });

    it("marks the ticked ones done by the revision, and counts the ones that refuse", async () => {
        server.todos = [todo("one", { assignee: "ada" }), todo("two", { assignee: "ada" }), todo("three", { assignee: "ada" })];
        const view = render(<Harness />);
        await waitFor(() => expect(view.container.querySelectorAll("input")).toHaveLength(3));
        const boxes = view.container.querySelectorAll("input");
        fireEvent.click(boxes[0]!);
        fireEvent.click(boxes[2]!);
        server.refuse.add("three");

        let failed = -1;
        await act(async () => {
            failed = await controller.finish("rev-42");
        });
        expect(failed).toBe(1);
        expect(server.calls.filter(call => call.method === "todos.update").map(call => call.params)).toEqual([
            { todo: "one", status: "done", doneRevision: "rev-42" },
            { todo: "three", status: "done", doneRevision: "rev-42" },
        ]);
        expect(controller.picked.size).toBe(0);
    });

    it("draws nothing when there is nothing to tick", async () => {
        server.todos = [];
        const view = render(<Harness />);
        await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
        expect(view.container.querySelector("[data-commit-todos]")).toBeNull();
    });
});
