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
    project: "p1",
    list: null as null | ((project: string) => Promise<{ ok: true; value: { todos: TeamTodo[] } }>),
    update: null as null | (() => Promise<{ ok: true; value: Record<string, never> }>),
}));

vi.mock("@/lib/team", () => ({
    useTeamConnection: () => ({ state: "ready", since: 1, capabilities: ["todos"], account: { id: "a1", username: "ada" } }),
    useTeamCapability: () => true,
    teamCall: async (_origin: string, method: string, params: Record<string, unknown>) => {
        server.calls.push({ method, params });
        if (method === "todos.list") return server.list ? server.list(params.project as string) : { ok: true, value: { todos: server.todos } };
        if (server.refuse.has(params.todo as string)) return { ok: false, error: { code: "refused" } };
        if (server.update) return server.update();
        return { ok: true, value: {} };
    },
}));

vi.mock("./TeamProjectContext", () => ({
    useTeamProjectSurface: () => ({
        remoteOrigin: "https://team.example:41402",
        state: { kind: "verified", project: { id: server.project, name: "harbour", description: "" } },
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
    server.project = "p1";
    server.list = null;
    server.update = null;
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

    it("ignores a late list from the previous project", async () => {
        let finishOld!: (value: { ok: true; value: { todos: TeamTodo[] } }) => void;
        server.list = project => project === "p1"
            ? new Promise(resolve => { finishOld = resolve; })
            : Promise.resolve({ ok: true, value: { todos: [todo("new", { assignee: "ada", project: "p2" })] } });
        const view = render(<Harness />);
        await waitFor(() => expect(server.calls).toHaveLength(1));

        server.project = "p2";
        view.rerender(<Harness />);
        await waitFor(() => expect(controller.todos.map(item => item.id)).toEqual(["new"]));
        await act(async () => { finishOld({ ok: true, value: { todos: [todo("old", { assignee: "ada" })] } }); });
        expect(controller.todos.map(item => item.id)).toEqual(["new"]);
    });

    it("clears the previous project's selected to-dos while the next list is loading", async () => {
        server.todos = [todo("old", { assignee: "ada" })];
        const view = render(<Harness />);
        await waitFor(() => expect(view.container.querySelector("input")).not.toBeNull());
        fireEvent.click(view.container.querySelector("input")!);
        expect(controller.picked.has("old")).toBe(true);

        server.list = () => new Promise(() => undefined);
        server.project = "p2";
        view.rerender(<Harness />);
        expect(controller.todos).toEqual([]);
        expect(controller.picked.size).toBe(0);
    });

    it("keeps the new project's selection when an earlier commit finishes late", async () => {
        server.todos = [todo("old", { assignee: "ada" })];
        let finishUpdate!: (value: { ok: true; value: Record<string, never> }) => void;
        server.update = () => new Promise(resolve => { finishUpdate = resolve; });
        const view = render(<Harness />);
        await waitFor(() => expect(view.container.querySelector("input")).not.toBeNull());
        fireEvent.click(view.container.querySelector("input")!);
        let finishing!: Promise<number>;
        act(() => { finishing = controller.finish("old-revision"); });

        server.project = "p2";
        server.todos = [todo("new", { assignee: "ada", project: "p2" })];
        view.rerender(<Harness />);
        await waitFor(() => expect(controller.todos.map(item => item.id)).toEqual(["new"]));
        fireEvent.click(view.container.querySelector("input")!);
        await act(async () => { finishUpdate({ ok: true, value: {} }); await finishing; });
        expect([...controller.picked]).toEqual(["new"]);
    });
});
