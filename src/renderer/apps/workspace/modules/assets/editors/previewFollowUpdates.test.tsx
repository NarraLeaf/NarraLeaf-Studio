// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPreviewEditor } from "./AudioPreviewEditor";
import { FontPreviewEditor } from "./FontPreviewEditor";
import { VideoPreviewEditor } from "./VideoPreviewEditor";

const library = vi.hoisted(() => {
    const listeners = new Set<(asset: { id: string; hash: string }) => void>();
    const fetch = vi.fn((_asset: { id: string; hash: string }) => new Promise(() => undefined));
    const service = {
        fetch,
        getEvents: () => ({
            on: (_event: string, listener: (asset: { id: string; hash: string }) => void) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        }),
    };
    return { listeners, fetch, context: { services: { get: () => service } } };
});

vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: library.context }) }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, locale: "en" }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "") };
});
vi.mock("@/apps/workspace/hooks", () => ({
    useKeybindings: () => undefined,
    whenEditorFocused: () => () => true,
    useHistoryScope: () => ({ clear: vi.fn(), checkpoint: vi.fn(), undo: vi.fn(), redo: vi.fn() }),
}));
vi.mock("@/apps/workspace/hooks/useShortcutLabels", () => ({
    useShortcutLabels: () => ({ forBinding: () => "" }),
}));
vi.mock("./useAssetReadNotice", () => ({ useAssetReadNotice: () => null }));
vi.mock("@/apps/workspace/components/layout/EditorProjectUndoKeybindings", () => ({
    EditorProjectUndoKeybindings: () => null,
}));

afterEach(() => {
    cleanup();
    library.listeners.clear();
    library.fetch.mockClear();
});

describe.each([
    ["audio", AudioPreviewEditor],
    ["font", FontPreviewEditor],
    ["video", VideoPreviewEditor],
] as const)("%s preview", (_kind, Editor) => {
    it("starts a new read when the library replaces the asset", async () => {
        const asset = { id: "clip", hash: "original", name: "clip.mp4", ext: "mp4" };
        render(<Editor tabId="preview" payload={{ asset } as never} active />);
        await waitFor(() => expect(library.fetch).toHaveBeenCalledTimes(1));

        act(() => library.listeners.forEach(listener => listener({ ...asset, hash: "replacement" })));

        await waitFor(() => expect(library.fetch).toHaveBeenCalledTimes(2));
        expect(library.fetch.mock.calls[1][0]).toMatchObject({ id: "clip", hash: "replacement" });
    });
});
