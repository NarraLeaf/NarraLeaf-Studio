// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptSourceView } from "./ScriptPreviewEditor";

const fixture = vi.hoisted(() => {
    let release!: () => void;
    const loading = new Promise<void>(resolve => { release = resolve; });
    return { read: vi.fn(), loading, release, editorLoading: false };
});
vi.mock("@/apps/workspace/context", () => {
    const context = {
        services: { get: () => ({ read: fixture.read }) },
        project: { getConfig: () => ({ projectPath: "/project" }), resolve: (parts: string[]) => parts.join("/") },
    };
    return { useWorkspace: () => ({ isInitialized: true, context }) };
});
vi.mock("@/lib/i18n", async importOriginal => {
    const translator = { t: (key: string) => key, tn: (key: string) => key, has: () => false, locale: "en" };
    return { ...(await importOriginal<Record<string, unknown>>()), useTranslation: () => translator };
});
vi.mock("./ScriptOpenMenu", () => ({ ScriptOpenMenu: () => null }));
vi.mock("@/apps/workspace/modules/assets/editors/text/studioMonaco", async () => {
    fixture.editorLoading = true;
    await fixture.loading;
    return {
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
    };
});

afterEach(cleanup);

describe("script preview editor loading", () => {
    it("opens with the latest source if a refresh finishes while the editor loads", async () => {
        fixture.read.mockResolvedValueOnce({ ok: true, data: "old source" }).mockResolvedValueOnce({ ok: true, data: "new source" });
        const view = render(<ScriptSourceView scriptRef="scripts/first.ts" />);
        await waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(fixture.editorLoading).toBe(true));
        fireEvent.click(view.getByRole("button", { name: "common.refresh" }));
        await waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(2));
        await act(async () => { await Promise.resolve(); fixture.release(); await fixture.loading; });
        await waitFor(() => expect(view.container.textContent).toContain("new source"));
        expect(view.container.textContent).not.toContain("old source");
    });
});
