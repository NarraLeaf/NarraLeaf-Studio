// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import { filterStore, usePluginCatalog } from "./usePluginCatalog";

/**
 * The store index as the catalog hands it to every surface that shows an entry.
 *
 * Pinned because the store printed the registry's top-level text whatever the interface language
 * was, and the top level is in whichever language a plugin's author wrote first: a Chinese reader
 * got English for one plugin, an English reader got Chinese for the next.
 */

const ENTRY: PluginRegistryEntry = {
    id: "narraleaf.steam-achievements",
    name: "Steam Achievements",
    version: "0.1.1",
    description: "Author Steam achievements and stats in Studio.",
    publisher: "narraleaf",
    targets: ["studio", "runtime"],
    categories: [],
    keywords: [],
    license: "MIT",
    permissions: [],
    locales: { "zh-CN": { name: "Steam 成就", description: "在 Studio 里编写 Steam 成就与统计量。" } },
    release: {
        tag: "narraleaf.steam-achievements@0.1.1",
        page: "https://example.com",
        download: "https://example.com/steam.zip",
    },
};

const language = vi.hoisted(() => ({ locale: "zh" }));
const registryFetch = vi.hoisted(() => vi.fn());

// A `t` that keeps its identity across renders: the catalog's loaders depend on it, and a fresh one
// per render would re-run them forever.
const t = (key: string) => key;

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t, locale: language.locale }),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        plugins: {
            list: async () => ({ success: true, data: { plugins: [] } }),
            registryFetch,
        },
    }),
}));

registryFetch.mockImplementation(async () => ({
    success: true,
    data: { registryUrl: "https://example.com/index.json", index: { formatVersion: 1, repository: "", plugins: [ENTRY] } },
}));

afterEach(() => {
    language.locale = "zh";
    registryFetch.mockClear();
});

describe("usePluginCatalog", () => {
    it("hands every surface the entry's words in the interface language", async () => {
        const { result } = renderHook(() => usePluginCatalog());

        await waitFor(() => expect(result.current.registry).not.toBeNull());
        expect(result.current.registry?.[0].name).toBe("Steam 成就");
        expect(result.current.registryById.get(ENTRY.id)?.description).toBe("在 Studio 里编写 Steam 成就与统计量。");
    });

    it("follows a language switch without fetching again", async () => {
        const { result, rerender } = renderHook(() => usePluginCatalog());
        await waitFor(() => expect(result.current.registry).not.toBeNull());

        language.locale = "en";
        rerender();

        expect(result.current.registry?.[0].name).toBe("Steam Achievements");
        expect(registryFetch).toHaveBeenCalledTimes(1);
    });

    it("finds an entry by the words the store shows", async () => {
        const { result } = renderHook(() => usePluginCatalog());
        await waitFor(() => expect(result.current.registry).not.toBeNull());

        expect(filterStore(result.current.registry ?? [], "成就").map(entry => entry.id)).toEqual([ENTRY.id]);
    });
});
