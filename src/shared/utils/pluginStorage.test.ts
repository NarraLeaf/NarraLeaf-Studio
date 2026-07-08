import { describe, expect, it } from "vitest";
import { parsePluginStoreOwner, pluginStoreNamespace } from "./pluginStorage";

describe("pluginStoreNamespace / parsePluginStoreOwner", () => {
    it("round-trips the owning plugin id", () => {
        const ns = pluginStoreNamespace("narraleaf.gallery", "settings");
        expect(ns).toBe("plugin__narraleaf.gallery__settings");
        expect(parsePluginStoreOwner(ns)).toBe("narraleaf.gallery");
    });

    it("recovers the owner even when the sub-namespace itself contains the delimiter", () => {
        const ns = pluginStoreNamespace("acme.kit", "a__b");
        expect(parsePluginStoreOwner(ns)).toBe("acme.kit");
    });

    it("sanitizes path separators so the store stays a single file", () => {
        const ns = pluginStoreNamespace("acme.kit", "../../escape");
        expect(ns.includes("/")).toBe(false);
        expect(parsePluginStoreOwner(ns)).toBe("acme.kit");
    });

    it("returns null for core (non-plugin) stores", () => {
        expect(parsePluginStoreOwner("characters")).toBeNull();
        expect(parsePluginStoreOwner("recentColors")).toBeNull();
        expect(parsePluginStoreOwner("plugin__")).toBeNull();
    });
});
