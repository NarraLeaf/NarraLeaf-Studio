import { describe, expect, it, vi } from "vitest";

// A lean window: the catalog index resolves its built-in set to the lean twin, as the renderer build
// does for the small windows (project/build/rendererLocales.js).
vi.mock("./builtinCatalogs", () => import("./builtinCatalogs.lean"));

describe("loading a built-in catalog on demand", () => {
    it("answers in English until the language arrives, then in it, and tells the registry", async () => {
        const { createTranslator, loadBuiltinCatalog, isBuiltinCatalogLoaded, subscribeLocaleRegistry } = await import("../index");
        expect(isBuiltinCatalogLoaded("zh")).toBe(false);
        expect(isBuiltinCatalogLoaded("ja")).toBe(false);
        expect(createTranslator("zh").t("settings.categories.general.label")).toBe("General");

        const notified = vi.fn();
        const unsubscribe = subscribeLocaleRegistry(notified);
        await loadBuiltinCatalog("zh");
        unsubscribe();

        expect(notified).toHaveBeenCalled();
        expect(isBuiltinCatalogLoaded("zh")).toBe(true);
        expect(isBuiltinCatalogLoaded("ja")).toBe(false);
        expect(createTranslator("zh").t("settings.categories.general.label")).toBe("常规");
    });

    it("lets the built-in text win over a language pack that arrived before it", async () => {
        const { createTranslator, loadBuiltinCatalog, setLocaleContributions } = await import("../index");
        setLocaleContributions([{ pluginId: "pack", code: "ja", messages: { "settings.categories.general.label": "上書き", "x.extra": "追加" } }], { onWarn: () => undefined });
        await loadBuiltinCatalog("ja");
        const { t, has } = createTranslator("ja");
        expect(t("settings.categories.general.label")).not.toBe("上書き");
        expect(has("x.extra")).toBe(true);
        setLocaleContributions([]);
    });

    it("does nothing for English or a plugin-only language", async () => {
        const { loadBuiltinCatalog } = await import("../index");
        await expect(loadBuiltinCatalog("en")).resolves.toBeUndefined();
        await expect(loadBuiltinCatalog("ko")).resolves.toBeUndefined();
    });
});
