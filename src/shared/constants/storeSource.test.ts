import { describe, expect, it } from "vitest";
import {
    readStoreSourcePreference,
    RETIRED_PLUGIN_REGISTRY_MIRROR_URL,
    STORE_SOURCE_KEY,
    storeSourceMigration,
} from "./storeSource";

describe("readStoreSourcePreference", () => {
    it("reads the four choices and anything else as automatic", () => {
        for (const value of ["auto", "github", "gitcode", "custom"]) {
            expect(readStoreSourcePreference(value)).toBe(value);
        }
        for (const value of [undefined, null, "", "GitHub", 1, {}]) {
            expect(readStoreSourcePreference(value)).toBe("auto");
        }
    });
});

describe("storeSourceMigration", () => {
    it("does nothing for a profile that never typed an address", () => {
        expect(storeSourceMigration({ "plugins.registryUrl": "", "uiTemplates.registryUrl": "" }))
            .toEqual({ set: {}, remove: [] });
        expect(storeSourceMigration({})).toEqual({ set: {}, remove: [] });
    });

    it("drops the retired China mirror and leaves the choice to read as automatic", () => {
        expect(storeSourceMigration({
            "plugins.registryUrl": RETIRED_PLUGIN_REGISTRY_MIRROR_URL,
            "uiTemplates.registryUrl": "",
        })).toEqual({ set: {}, remove: ["plugins.registryUrl"] });
        // Stored with stray whitespace, it is still that option.
        expect(storeSourceMigration({ "plugins.registryUrl": `  ${RETIRED_PLUGIN_REGISTRY_MIRROR_URL} ` }).remove)
            .toEqual(["plugins.registryUrl"]);
    });

    it("turns a typed registry address into the custom choice, so it keeps being read", () => {
        expect(storeSourceMigration({ "plugins.registryUrl": "http://127.0.0.1:8123/index.json" }))
            .toEqual({ set: { [STORE_SOURCE_KEY]: "custom" }, remove: [] });
        expect(storeSourceMigration({ "uiTemplates.registryUrl": "https://mirror.example.com/index.json" }))
            .toEqual({ set: { [STORE_SOURCE_KEY]: "custom" }, remove: [] });
        // The China mirror goes either way; the template address still makes it custom.
        expect(storeSourceMigration({
            "plugins.registryUrl": RETIRED_PLUGIN_REGISTRY_MIRROR_URL,
            "uiTemplates.registryUrl": "https://mirror.example.com/index.json",
        })).toEqual({ set: { [STORE_SOURCE_KEY]: "custom" }, remove: ["plugins.registryUrl"] });
    });

    it("never overrides a choice that is already stored", () => {
        for (const choice of ["auto", "github", "gitcode", "custom"]) {
            expect(storeSourceMigration({
                [STORE_SOURCE_KEY]: choice,
                "plugins.registryUrl": "http://127.0.0.1:8123/index.json",
            }).set).toEqual({});
        }
    });
});
