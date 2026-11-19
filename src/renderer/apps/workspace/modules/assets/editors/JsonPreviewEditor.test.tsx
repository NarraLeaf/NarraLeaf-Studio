// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonPreviewEditor } from "./JsonPreviewEditor";

const library = vi.hoisted(() => {
    const listeners = new Set<(asset: { id: string; hash: string }) => void>();
    const fetch = vi.fn();
    const service = {
        fetch,
        getEvents: () => ({
            on: (event: string, listener: (asset: { id: string; hash: string }) => void) => {
                if (event === "updated") listeners.add(listener);
                return () => listeners.delete(listener);
            },
        }),
    };
    return { listeners, fetch, context: { services: { get: () => service } } };
});

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: library.context }),
}));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./useAssetReadNotice", () => ({ useAssetReadNotice: () => null }));
vi.mock("@/apps/workspace/components/layout/EditorProjectUndoKeybindings", () => ({
    EditorProjectUndoKeybindings: () => null,
}));

afterEach(() => {
    cleanup();
    library.listeners.clear();
    library.fetch.mockReset();
});

describe("JSON preview", () => {
    it("shows replaced contents and the restored contents after an asset update", async () => {
        library.fetch.mockImplementation(async (asset: { hash: string }) => ({
            success: true,
            data: { data: { version: asset.hash } },
        }));
        const asset = { id: "config", hash: "original", name: "config.json" };
        render(<JsonPreviewEditor tabId="json" payload={{ asset } as never} active />);

        await screen.findByText(/"version": "original"/);
        act(() => library.listeners.forEach(listener => listener({ ...asset, hash: "replacement" })));
        await waitFor(() => expect(screen.getByText(/"version": "replacement"/)).toBeTruthy());
        act(() => library.listeners.forEach(listener => listener(asset)));
        await waitFor(() => expect(screen.getByText(/"version": "original"/)).toBeTruthy());
    });
});
