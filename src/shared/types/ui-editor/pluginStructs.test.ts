/**
 * Row shapes a plugin declares in its manifest.
 *
 * They resolve like the engine's own for as long as the plugin is loaded - locked, never stored in a
 * project's table, fields keyed by their names - and are gone when it is not, so a list that names one
 * reads as a list whose shape is missing rather than as one with the wrong fields.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
    isBuiltinUIStructId,
    isPluginUIStructId,
    listEngineUIStructIds,
    pluginUIStructName,
    registerPluginUIStructs,
    resolveUIStruct,
} from "./builtinStructs";

const SHOP = [{
    id: "acme.shop.good",
    name: "Shop item",
    localized: { zh: "商品" },
    fields: [{ key: "name", type: "string" as const }, { key: "price", type: "number" as const }],
}];

let dispose: (() => void) | null = null;
afterEach(() => {
    dispose?.();
    dispose = null;
});

describe("plugin row shapes", () => {
    it("resolve while the plugin is loaded, with each field keyed by its name", () => {
        dispose = registerPluginUIStructs("acme.shop", SHOP);
        expect(resolveUIStruct(null, "acme.shop.good")).toEqual({
            id: "acme.shop.good",
            fields: [
                { id: "name", key: "name", type: "string" },
                { id: "price", key: "price", type: "number" },
            ],
        });
        expect(isBuiltinUIStructId("acme.shop.good")).toBe(true);
        expect(isPluginUIStructId("acme.shop.good")).toBe(true);
        expect(isPluginUIStructId("nl.ending")).toBe(false);
        expect(listEngineUIStructIds()).toContain("acme.shop.good");
    });

    it("are named by the manifest, in the editor's language where it gives one", () => {
        dispose = registerPluginUIStructs("acme.shop", SHOP);
        expect(pluginUIStructName("acme.shop.good", "zh")).toBe("商品");
        expect(pluginUIStructName("acme.shop.good", "ja")).toBe("Shop item");
        expect(pluginUIStructName("nl.ending", "zh")).toBeNull();
    });

    it("are gone once the plugin is", () => {
        registerPluginUIStructs("acme.shop", SHOP)();
        expect(resolveUIStruct(null, "acme.shop.good")).toBeNull();
        expect(isBuiltinUIStructId("acme.shop.good")).toBe(false);
    });

    it("never stand in for a shape the project itself stores under the same id", () => {
        dispose = registerPluginUIStructs("acme.shop", SHOP);
        const own = { id: "acme.shop.good", fields: [{ id: "f1", key: "title", type: "string" as const }] };
        expect(resolveUIStruct({ structs: { "acme.shop.good": own } }, "acme.shop.good")).toBe(own);
    });
});
