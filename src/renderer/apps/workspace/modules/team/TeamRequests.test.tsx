// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageAssignmentForm, ReviewRequestForm, RowAssetRequest } from "./TeamRequests";

const server = vi.hoisted(() => ({
    project: "p1",
    writes: [] as string[],
    lastWrite: null as null | { method: string; params: { project?: string; toRevision?: string } },
    members: null as null | ((project: string) => Promise<unknown>),
    revisions: [{ id: "revision-1", message: "Start" }] as Array<{ id: string; message?: string }>,
    write: null as null | (() => Promise<unknown>),
}));

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({
    t: (key: string, params?: { name?: string; index?: string }) =>
        key === "documentDiff.name.numbered" ? `${params?.name} ${params?.index}` : key,
}) }));
vi.mock("@/lib/team", () => ({
    useTeamConnection: () => ({ state: "ready", since: 1, account: { username: "ada" } }),
    useTeamCapability: () => true,
    teamCall: async (_origin: string, method: string, params: { project?: string; toRevision?: string }) => {
        if (method === "projects.members.list") {
            return server.members ? server.members(params.project ?? "") : { ok: true, value: { members: [{ username: "bob", displayName: "Bob" }] } };
        }
        if (method === "projects.history") return { ok: true, value: { revisions: server.revisions } };
        server.writes.push(method);
        server.lastWrite = { method, params };
        return server.write ? server.write() : new Promise(() => undefined);
    },
}));
vi.mock("./TeamProjectContext", () => ({
    useTeamProjectSurface: () => ({ remoteOrigin: "team", state: { kind: "verified", project: { id: server.project, role: "editor" } } }),
}));
vi.mock("../../context", () => ({
    useWorkspace: () => ({ context: { services: { get: () => ({ listStories: () => [{ id: "story-1", name: "Story" }] }) } } }),
}));

beforeEach(() => {
    server.project = "p1";
    server.writes = [];
    server.lastWrite = null;
    server.members = null;
    server.write = null;
    server.revisions = [{ id: "revision-1", message: "Start" }];
});

afterEach(cleanup);

describe("team requests", () => {
    it("names versions without displaying their identifiers and sends the selected revision", async () => {
        server.revisions = [
            { id: "11111111-1111-4111-8111-111111111111", message: "Chapter one" },
            { id: "22222222-2222-4222-8222-222222222222" },
            { id: "33333333-3333-4333-8333-333333333333" },
        ];
        render(<ReviewRequestForm />);
        await screen.findByText("Bob");
        const to = screen.getByLabelText("workspace.shell.team.requests.to") as HTMLSelectElement;
        await waitFor(() => expect(to.options).toHaveLength(3));
        const labels = [...to.options].map(option => option.textContent);
        expect(labels[0]).toBe("Chapter one");
        expect(labels[1]).not.toContain("22222222");
        expect(labels[1]).not.toBe(labels[2]);
        fireEvent.change(screen.getByPlaceholderText("workspace.shell.team.requests.reviewTitle"), { target: { value: "Review" } });
        fireEvent.change(screen.getByLabelText("workspace.shell.team.requests.reviewer"), { target: { value: "bob" } });
        fireEvent.change(to, { target: { value: server.revisions[1]!.id } });
        fireEvent.click(screen.getByText("workspace.shell.team.requests.sendReview"));
        expect(to.value).toBe(server.revisions[1]!.id);
        expect(server.writes).toEqual(["reviews.create"]);
        expect(server.lastWrite?.params.toRevision).toBe(server.revisions[1]!.id);
    });

    it("sends a review once while its first request is pending", async () => {
        render(<ReviewRequestForm />);
        await screen.findByText("Bob");
        fireEvent.change(screen.getByPlaceholderText("workspace.shell.team.requests.reviewTitle"), { target: { value: "Review" } });
        fireEvent.change(screen.getByLabelText("workspace.shell.team.requests.reviewer"), { target: { value: "bob" } });
        const send = screen.getByText("workspace.shell.team.requests.sendReview");
        fireEvent.click(send);
        fireEvent.click(send);
        expect(server.writes).toEqual(["reviews.create"]);
        expect((send as HTMLButtonElement).disabled).toBe(true);
    });

    it("sends a language assignment once while its first request is pending", () => {
        render(<LanguageAssignmentForm />);
        fireEvent.change(screen.getByPlaceholderText("workspace.shell.team.requests.locale"), { target: { value: "ja" } });
        const send = screen.getByText("workspace.shell.team.requests.assign");
        fireEvent.click(send);
        fireEvent.click(send);
        expect(server.writes).toEqual(["todos.create"]);
        expect((send as HTMLButtonElement).disabled).toBe(true);
    });

    it("sends a row asset request once while its first request is pending", () => {
        render(<RowAssetRequest storyId="story-1" sceneId="scene-1" blockId="row-1" />);
        fireEvent.click(screen.getByText(/workspace\.shell\.team\.requests\.askAsset/));
        fireEvent.change(screen.getByPlaceholderText("workspace.shell.team.requests.assetPlaceholder"), { target: { value: "Artwork" } });
        const send = screen.getByText("workspace.shell.team.requests.sendAsset");
        fireEvent.click(send);
        fireEvent.click(send);
        expect(server.writes).toEqual(["todos.create"]);
        expect((send as HTMLButtonElement).disabled).toBe(true);
    });

    it("allows a failed assignment to be retried", async () => {
        server.write = async () => ({ ok: false, problem: { kind: "offline" } });
        render(<LanguageAssignmentForm />);
        fireEvent.change(screen.getByPlaceholderText("workspace.shell.team.requests.locale"), { target: { value: "ja" } });
        const send = screen.getByText("workspace.shell.team.requests.assign") as HTMLButtonElement;
        fireEvent.click(send);
        await screen.findByText("workspace.shell.team.requests.failed");
        await waitFor(() => expect(send.disabled).toBe(false));
        fireEvent.click(send);
        expect(server.writes).toEqual(["todos.create", "todos.create"]);
    });

    it("ignores members returned after the project has changed", async () => {
        let finishOld!: (value: unknown) => void;
        server.members = project => project === "p1"
            ? new Promise(resolve => { finishOld = resolve; })
            : Promise.resolve({ ok: true, value: { members: [{ username: "eve", displayName: "Eve" }] } });
        const view = render(<ReviewRequestForm />);
        server.project = "p2";
        view.rerender(<ReviewRequestForm />);
        await screen.findByText("Eve");
        await act(async () => { finishOld({ ok: true, value: { members: [{ username: "bob", displayName: "Bob" }] } }); });
        await waitFor(() => expect(screen.queryByText("Bob")).toBeNull());
        expect(screen.getByText("Eve")).toBeTruthy();
    });
});
