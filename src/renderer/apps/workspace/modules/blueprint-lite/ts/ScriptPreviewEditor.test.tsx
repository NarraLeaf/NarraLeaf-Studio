// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptSourceView } from "./ScriptPreviewEditor";

const fixture = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/apps/workspace/context", () => {
    const context = {
        services: { get: () => ({ read: fixture.read }) },
        project: { getConfig: () => ({ projectPath: "/project" }), resolve: (parts: string[]) => parts.join("/") },
    };
    return { useWorkspace: () => ({ isInitialized: true, context }) };
});
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, has: () => false, locale: "en" }),
}));
vi.mock("./ScriptOpenMenu", () => ({ ScriptOpenMenu: () => null }));
vi.mock("@/apps/workspace/modules/assets/editors/text/studioMonaco", () => ({
    defineStudioMonacoTheme: () => undefined,
    watchStudioMonacoTheme: () => () => undefined,
    WORKER_FREE_EDITOR_OPTIONS: {},
    STUDIO_MONACO_THEME: "test",
    monaco: { editor: { create: (host: HTMLElement, options: { value: string }) => {
        host.textContent = options.value;
        const model = {
            getValue: () => host.textContent,
            setValue: (value: string) => { host.textContent = value; },
            dispose: () => undefined,
        };
        return { getModel: () => model, saveViewState: () => null, dispose: () => undefined };
    } } },
}));

afterEach(() => { cleanup(); fixture.read.mockReset(); });

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

describe("script preview reads", () => {
    it("keeps the current script when an earlier read completes later", async () => {
        const earlier = deferred<{ ok: true; data: string }>();
        const current = deferred<{ ok: true; data: string }>();
        fixture.read.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(current.promise);
        const view = render(<ScriptSourceView scriptRef="scripts/first.ts" />);
        view.rerender(<ScriptSourceView scriptRef="scripts/second.ts" />);
        await act(async () => { current.resolve({ ok: true, data: "second source" }); await current.promise; });
        await waitFor(() => expect(view.container.textContent).toContain("second source"));
        await act(async () => { earlier.resolve({ ok: true, data: "first source" }); await earlier.promise; });
        expect(view.container.textContent).toContain("second source");
        expect(view.container.textContent).not.toContain("first source");
    });

    it("keeps the latest refresh when two reads finish out of order", async () => {
        const earlier = deferred<{ ok: true; data: string }>();
        const current = deferred<{ ok: true; data: string }>();
        fixture.read.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(current.promise);
        const view = render(<ScriptSourceView scriptRef="scripts/first.ts" />);
        fireEvent.click(view.getByRole("button", { name: "common.refresh" }));
        await act(async () => { current.resolve({ ok: true, data: "new source" }); await current.promise; });
        await waitFor(() => expect(view.container.textContent).toContain("new source"));
        await act(async () => { earlier.resolve({ ok: true, data: "old source" }); await earlier.promise; });
        expect(view.container.textContent).toContain("new source");
        expect(view.container.textContent).not.toContain("old source");
    });
});
