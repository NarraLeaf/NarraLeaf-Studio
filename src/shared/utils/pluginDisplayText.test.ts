import { describe, expect, it } from "vitest";
import { pluginDisplayDescription, pluginDisplayName } from "./pluginDisplayText";

const manifest = {
    name: "Gallery",
    description: "Author the EXTRA screens.",
    localized: {
        zh: { name: "画廊", description: "制作附加内容界面" },
        ja: { name: "ギャラリー" },
    },
};

describe("pluginDisplayName / pluginDisplayDescription", () => {
    it("reads the entry for the exact locale", () => {
        expect(pluginDisplayName(manifest, "zh")).toBe("画廊");
        expect(pluginDisplayDescription(manifest, "zh")).toBe("制作附加内容界面");
    });

    it("falls back field by field", () => {
        expect(pluginDisplayName(manifest, "ja")).toBe("ギャラリー");
        expect(pluginDisplayDescription(manifest, "ja")).toBe("Author the EXTRA screens.");
    });

    it("reads the plain fields for a locale with no entry, and without a locale", () => {
        expect(pluginDisplayName(manifest, "en")).toBe("Gallery");
        expect(pluginDisplayName(manifest, undefined)).toBe("Gallery");
        expect(pluginDisplayDescription(manifest, undefined)).toBe("Author the EXTRA screens.");
    });

    it("matches no region variant: an entry under zh-CN is not shown for zh, nor zh for zh-CN", () => {
        const regional = { name: "Gallery", localized: { "zh-CN": { name: "画廊" } } };
        expect(pluginDisplayName(regional, "zh")).toBe("Gallery");
        expect(pluginDisplayName(manifest, "zh-CN")).toBe("Gallery");
    });

    it("does not read inherited properties as entries", () => {
        expect(pluginDisplayName(manifest, "constructor")).toBe("Gallery");
        expect(pluginDisplayName({ name: "Plain" }, "zh")).toBe("Plain");
    });
});
