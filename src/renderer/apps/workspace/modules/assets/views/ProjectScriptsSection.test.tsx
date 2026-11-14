// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "@shared/utils/fs";
import { ProjectScriptsSection } from "./ProjectScriptsSection";

const environment = vi.hoisted(() => ({
    context: null as unknown,
    initialized: true,
    revision: 0,
}));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: environment.context, isInitialized: environment.initialized }),
}));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string, n: number) => `${key}:${n}`, locale: "en" }),
}));
vi.mock("../../blueprint-lite/hooks/useBlueprintDocumentRevision", () => ({
    useBlueprintDocumentRevision: () => environment.revision,
}));
vi.mock("../../blueprint-lite/hooks/useOpenBlueprintTarget", () => ({ useOpenBlueprintTarget: () => () => undefined }));
vi.mock("../../blueprint-lite/ts/ScriptOpenMenu", () => ({ ScriptOpenMenu: () => null }));
vi.mock("../../blueprint-lite/ts/ScriptPreviewEditor", () => ({ ScriptPreviewEditor: () => null }));
vi.mock("@/lib/components/elements/Accordion", () => ({
    AccordionItem: ({ children, actions }: { children: React.ReactNode; actions: React.ReactNode }) => (
        <div>{actions}{children}</div>
    ),
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function file(fileName: string): FileEntry {
    return { type: "file", fileName, name: fileName.replace(/\.ts$/, ""), ext: "ts" };
}

function workspace(list: () => Promise<{ ok: true; data: FileEntry[] }>) {
    return {
        project: { getConfig: () => ({ projectPath: "project" }), resolve: (parts: string[]) => parts.join("/") },
        services: { get: (id: string) => id === "fileSystem"
            ? { list }
            : { getBlueprintDocument: () => ({ blueprints: {} }) } },
    };
}

afterEach(() => {
    cleanup();
    environment.context = null;
    environment.initialized = true;
    environment.revision = 0;
});

describe("project script listing refresh", () => {
    it("keeps the later listing when an older request finishes afterwards", async () => {
        const older = deferred<{ ok: true; data: FileEntry[] }>();
        const newer = deferred<{ ok: true; data: FileEntry[] }>();
        const list = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        environment.context = workspace(list);
        const view = render(<ProjectScriptsSection open />);
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
        environment.revision = 1;
        view.rerender(<ProjectScriptsSection open />);
        await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

        await act(async () => newer.resolve({ ok: true, data: [file("new.ts")] }));
        expect(screen.getByText("new.ts")).toBeTruthy();
        await act(async () => older.resolve({ ok: true, data: [file("old.ts")] }));

        expect(screen.getByText("new.ts")).toBeTruthy();
        expect(screen.queryByText("old.ts")).toBeNull();
    });

    it("keeps the loading indicator until the latest request finishes", async () => {
        const older = deferred<{ ok: true; data: FileEntry[] }>();
        const newer = deferred<{ ok: true; data: FileEntry[] }>();
        const list = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        environment.context = workspace(list);
        const view = render(<ProjectScriptsSection open />);
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
        environment.revision = 1;
        view.rerender(<ProjectScriptsSection open />);
        await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

        await act(async () => older.resolve({ ok: true, data: [file("old.ts")] }));
        expect(screen.queryByRole("button", { name: "common.refresh" })).toBeNull();
        expect(screen.queryByText("old.ts")).toBeNull();
        await act(async () => newer.resolve({ ok: true, data: [file("new.ts")] }));
        expect(screen.getByText("new.ts")).toBeTruthy();
        expect(screen.getByRole("button", { name: "common.refresh" })).toBeTruthy();
    });

    it("does not publish a previous workspace's result after a project switch", async () => {
        const older = deferred<{ ok: true; data: FileEntry[] }>();
        const newer = deferred<{ ok: true; data: FileEntry[] }>();
        environment.context = workspace(() => older.promise);
        const view = render(<ProjectScriptsSection open />);
        environment.context = workspace(() => newer.promise);
        view.rerender(<ProjectScriptsSection open />);

        await act(async () => newer.resolve({ ok: true, data: [file("current.ts")] }));
        expect(screen.getByText("current.ts")).toBeTruthy();
        await act(async () => older.resolve({ ok: true, data: [file("previous.ts")] }));
        expect(screen.getByText("current.ts")).toBeTruthy();
        expect(screen.queryByText("previous.ts")).toBeNull();
    });

    it("clears the previous workspace's listing while the new one is loading", async () => {
        const next = deferred<{ ok: true; data: FileEntry[] }>();
        environment.context = workspace(async () => ({ ok: true, data: [file("previous.ts")] }));
        const view = render(<ProjectScriptsSection open />);
        await screen.findByText("previous.ts");

        environment.context = workspace(() => next.promise);
        view.rerender(<ProjectScriptsSection open />);

        expect(screen.queryByText("previous.ts")).toBeNull();
        await act(async () => next.resolve({ ok: true, data: [file("current.ts")] }));
        expect(screen.getByText("current.ts")).toBeTruthy();
    });

    it("clears the listing when the same context points to a different project", async () => {
        const next = deferred<{ ok: true; data: FileEntry[] }>();
        let projectPath = "project-a";
        const list = vi.fn()
            .mockResolvedValueOnce({ ok: true, data: [file("previous.ts")] })
            .mockReturnValueOnce(next.promise);
        const context = workspace(list);
        context.project.getConfig = () => ({ projectPath });
        environment.context = context;
        const view = render(<ProjectScriptsSection open />);
        await screen.findByText("previous.ts");

        projectPath = "project-b";
        view.rerender(<ProjectScriptsSection open />);

        expect(screen.queryByText("previous.ts")).toBeNull();
        await act(async () => next.resolve({ ok: true, data: [file("current.ts")] }));
        expect(screen.getByText("current.ts")).toBeTruthy();
    });

    it("prefers a blueprint-triggered refresh over an older manual refresh", async () => {
        const manual = deferred<{ ok: true; data: FileEntry[] }>();
        const newer = deferred<{ ok: true; data: FileEntry[] }>();
        const list = vi.fn()
            .mockResolvedValueOnce({ ok: true, data: [file("initial.ts")] })
            .mockReturnValueOnce(manual.promise)
            .mockReturnValueOnce(newer.promise);
        environment.context = workspace(list);
        const view = render(<ProjectScriptsSection open />);
        await screen.findByText("initial.ts");

        fireEvent.click(screen.getByRole("button", { name: "common.refresh" }));
        await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
        environment.revision = 1;
        view.rerender(<ProjectScriptsSection open />);
        await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
        await act(async () => newer.resolve({ ok: true, data: [file("new.ts")] }));
        await act(async () => manual.resolve({ ok: true, data: [file("old.ts")] }));

        expect(screen.getByText("new.ts")).toBeTruthy();
        expect(screen.queryByText("old.ts")).toBeNull();
    });

    it("releases loading after a refresh throws and keeps the existing listing", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const list = vi.fn()
            .mockResolvedValueOnce({ ok: true, data: [file("existing.ts")] })
            .mockRejectedValueOnce(new Error("read failed"));
        environment.context = workspace(list);
        render(<ProjectScriptsSection open />);
        await screen.findByText("existing.ts");

        fireEvent.click(screen.getByRole("button", { name: "common.refresh" }));

        await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
        expect(screen.getByText("existing.ts")).toBeTruthy();
        expect(screen.getByRole("button", { name: "common.refresh" })).toBeTruthy();
        warn.mockRestore();
    });

    it("clears the listing when the workspace becomes uninitialised", async () => {
        environment.context = workspace(async () => ({ ok: true, data: [file("current.ts")] }));
        const view = render(<ProjectScriptsSection open />);
        await screen.findByText("current.ts");

        environment.initialized = false;
        view.rerender(<ProjectScriptsSection open />);
        expect(screen.queryByText("current.ts")).toBeNull();
    });
});
