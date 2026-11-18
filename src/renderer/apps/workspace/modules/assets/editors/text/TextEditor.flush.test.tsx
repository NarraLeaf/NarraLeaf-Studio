// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextEditor } from "./TextEditor";

const env = vi.hoisted(() => {
    const state: {
        text: string;
        change?: () => void;
        model: unknown;
        commands?: { reopenWith: (encoding: "gbk") => void };
    } = { text: "", model: null };
    const disposable = () => ({ dispose: () => undefined });
    const editor = {
        onDidChangeModelContent: (listener: () => void) => { state.change = listener; return disposable(); },
        onDidChangeCursorPosition: disposable,
        onDidChangeCursorSelection: disposable,
        getModel: () => state.model,
        setModel: (model: unknown) => { state.model = model; },
        getPosition: () => ({ lineNumber: 1, column: 1 }),
        getSelections: () => [],
        updateOptions: () => undefined,
        layout: () => undefined,
        dispose: () => undefined,
    };
    const createModel = vi.fn((text: string) => {
        state.text = text;
        return { getValue: () => state.text, setEOL: () => undefined, dispose: () => undefined };
    });
    const write = vi.fn(async (): Promise<{ success: boolean; error?: string }> => ({ success: true }));
    const read = vi.fn(async () => ({ ok: true, data: "before" }));
    const services = {
        get: (id: string) => {
            if (id === "fileSystem") return {
                readRaw: async () => ({ ok: true, data: new Uint8Array() }),
                read,
            };
            if (id === "assets") return {
                writeAssetTextContent: write,
                getAssets: () => ({}),
                patchAssetExtras: vi.fn(),
            };
            return {
                editor: { setModified: () => undefined, promote: () => undefined },
                textDocumentStatus: {
                    register: (_status: unknown, commands: typeof state.commands) => {
                        state.commands = commands;
                        return () => undefined;
                    },
                    update: () => undefined,
                },
            };
        },
    };
    return { state, editor, createModel, write, read, context: { services, project: { resolve: () => "asset" } } };
});

vi.mock("./studioMonaco", () => ({
    monaco: { editor: {
        create: () => env.editor,
        createModel: env.createModel,
        EndOfLineSequence: { LF: 0, CRLF: 1 },
    } },
    WORKER_FREE_EDITOR_OPTIONS: {},
    STUDIO_MONACO_THEME: "test",
    defineStudioMonacoTheme: () => undefined,
    watchStudioMonacoTheme: () => () => undefined,
}));
vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: env.context }) }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "") };
});
vi.mock("@/apps/workspace/hooks/useUIService", () => ({
    useTextEditorActions: () => [],
    useTextEditorLanguages: () => [],
    useTextEditorPreviews: () => [],
}));
vi.mock("./useTextEditorViewOptions", () => ({
    useTextEditorViewOptions: () => ({ lineNumbers: true, softWrap: false }),
}));

afterEach(() => {
    cleanup();
    env.createModel.mockClear();
    env.write.mockReset();
    env.write.mockResolvedValue({ success: true });
    env.read.mockClear();
    env.state.change = undefined;
    env.state.commands = undefined;
    env.state.model = null;
});

describe("text editor autosave", () => {
    it("writes a pending edit when the tab closes before the debounce", async () => {
        const asset = {
            id: "0f8a2c4e-1b3d-4e5f-8a9b-0c1d2e3f4a5b", type: "other", source: "local", name: "notes.txt",
        };
        const view = render(<TextEditor tabId="text" payload={{ asset } as never} active />);
        await waitFor(() => expect(env.createModel).toHaveBeenCalledWith("before", "plaintext"));

        act(() => {
            env.state.text = "latest edit";
            env.state.change?.();
        });
        view.unmount();

        expect(env.write).toHaveBeenCalledWith(asset, "latest edit", "utf8");
    });

    it("does not write the same edit twice after the tab is deactivated", async () => {
        const asset = {
            id: "0f8a2c4e-1b3d-4e5f-8a9b-0c1d2e3f4a5b", type: "other", source: "local", name: "notes.txt",
        };
        const view = render(<TextEditor tabId="text" payload={{ asset } as never} active />);
        await waitFor(() => expect(env.createModel).toHaveBeenCalledWith("before", "plaintext"));
        act(() => {
            env.state.text = "latest edit";
            env.state.change?.();
        });

        view.rerender(<TextEditor tabId="text" payload={{ asset } as never} active={false} />);
        await waitFor(() => expect(env.write).toHaveBeenCalledTimes(1));
        view.unmount();

        expect(env.write).toHaveBeenCalledTimes(1);
        expect(env.write).toHaveBeenCalledWith(asset, "latest edit", "utf8");
    });

    it("keeps the buffer open when saving before reopening with another encoding fails", async () => {
        env.write
            .mockResolvedValueOnce({ success: false, error: "Could not save" })
            .mockResolvedValueOnce({ success: false, error: "Could not save" });
        const asset = {
            id: "0f8a2c4e-1b3d-4e5f-8a9b-0c1d2e3f4a5b", type: "other", source: "local", name: "notes.txt",
        };
        const view = render(<TextEditor tabId="text" payload={{ asset } as never} active />);
        await waitFor(() => expect(env.createModel).toHaveBeenCalledWith("before", "plaintext"));
        act(() => {
            env.state.text = "latest edit";
            env.state.change?.();
        });

        await act(async () => env.state.commands?.reopenWith("gbk"));

        expect(env.write).toHaveBeenCalledWith(asset, "latest edit", "utf8");
        expect(env.read).toHaveBeenCalledTimes(1);
        expect(env.state.text).toBe("latest edit");
        expect(view.getByText("Could not save")).toBeTruthy();

        await act(async () => env.state.commands?.reopenWith("gbk"));
        expect(env.write).toHaveBeenCalledTimes(2);
        expect(env.read).toHaveBeenCalledTimes(1);
        expect(env.state.text).toBe("latest edit");
    });

    it("reopens after saving a pending edit successfully", async () => {
        const asset = {
            id: "0f8a2c4e-1b3d-4e5f-8a9b-0c1d2e3f4a5b", type: "other", source: "local", name: "notes.txt",
        };
        render(<TextEditor tabId="text" payload={{ asset } as never} active />);
        await waitFor(() => expect(env.createModel).toHaveBeenCalledWith("before", "plaintext"));
        act(() => {
            env.state.text = "latest edit";
            env.state.change?.();
        });

        await act(async () => env.state.commands?.reopenWith("gbk"));

        expect(env.write).toHaveBeenCalledWith(asset, "latest edit", "utf8");
        expect(env.read).toHaveBeenCalledTimes(2);
    });
});
