import { afterEach, describe, expect, it } from "vitest";
import { setLocaleContributions } from "@shared/i18n/registry";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import { localizePluginRegistryEntry } from "./pluginRegistryText";

/**
 * Which words the store shows for a registry entry.
 *
 * The two published shapes are both here: an entry written in English with a `zh-CN` pack, and one
 * written in Chinese with an `en` pack. The registry keys its packs by BCP-47 tag while Studio's
 * languages are `en` / `zh` / `ja`, so every case below goes through the tag a language formats with.
 */

function entry(overrides: Partial<PluginRegistryEntry>): PluginRegistryEntry {
    return {
        id: "acme.demo",
        name: "Demo",
        version: "1.0.0",
        description: "A demo plugin",
        publisher: "acme",
        targets: ["studio"],
        categories: [],
        keywords: [],
        license: "MIT",
        permissions: [],
        release: { tag: "acme.demo@1.0.0", page: "https://example.com", download: "https://example.com/a.zip" },
        ...overrides,
    };
}

/** English at the top level, Simplified Chinese beside it - the Steam achievements entry's shape. */
const ENGLISH_FIRST = entry({
    name: "Steam Achievements",
    description: "Author Steam achievements and stats in Studio.",
    locales: { "zh-CN": { name: "Steam 成就", description: "在 Studio 里编写 Steam 成就与统计量。" } },
});

/** Chinese at the top level, English beside it - the WakaTime entry's shape. */
const CHINESE_FIRST = entry({
    name: "WakaTime",
    description: "允许 NarraLeaf Studio 与 WakaTime 通讯。",
    locales: { en: { name: "WakaTime", description: "Lets NarraLeaf Studio talk to WakaTime." } },
});

afterEach(() => setLocaleContributions([]));

describe("localizePluginRegistryEntry", () => {
    it("takes the pack for the interface language's exact tag", () => {
        // Studio's `zh` formats as `zh-CN`, which is the tag the registry wrote.
        const shown = localizePluginRegistryEntry(ENGLISH_FIRST, "zh");
        expect(shown.name).toBe("Steam 成就");
        expect(shown.description).toBe("在 Studio 里编写 Steam 成就与统计量。");
    });

    it("takes the base language's pack when there is none for the exact tag", () => {
        // `en` formats as `en-US`; the registry has only `en`.
        const shown = localizePluginRegistryEntry(CHINESE_FIRST, "en");
        expect(shown.description).toBe("Lets NarraLeaf Studio talk to WakaTime.");
    });

    it("keeps the top-level text when no pack matches", () => {
        expect(localizePluginRegistryEntry(ENGLISH_FIRST, "en").name).toBe("Steam Achievements");
        expect(localizePluginRegistryEntry(ENGLISH_FIRST, "ja").name).toBe("Steam Achievements");
        // No Japanese pack and no English fallback between them: the author's own text stands.
        expect(localizePluginRegistryEntry(CHINESE_FIRST, "ja").description).toBe("允许 NarraLeaf Studio 与 WakaTime 通讯。");
        expect(localizePluginRegistryEntry(entry({}), "zh").name).toBe("Demo");
    });

    it("prefers the exact tag over the base language", () => {
        const both = entry({
            locales: {
                zh: { name: "演示（通用）" },
                "zh-CN": { name: "演示" },
            },
        });
        expect(localizePluginRegistryEntry(both, "zh").name).toBe("演示");
    });

    it("falls back field by field", () => {
        const nameOnly = entry({ locales: { "zh-CN": { name: "演示" } } });
        const shown = localizePluginRegistryEntry(nameOnly, "zh");
        expect(shown.name).toBe("演示");
        expect(shown.description).toBe("A demo plugin");
    });

    it("compares tags without regard to case", () => {
        const lower = entry({ locales: { "zh-cn": { name: "演示" } } });
        expect(localizePluginRegistryEntry(lower, "zh").name).toBe("演示");
    });

    it("answers a language pack's locale through the tag it declares", () => {
        setLocaleContributions([{ pluginId: "acme.neko", code: "zh-x-neko", meta: { intl: "zh-CN" }, messages: {} }]);
        expect(localizePluginRegistryEntry(ENGLISH_FIRST, "zh-x-neko").name).toBe("Steam 成就");
    });

    it("leaves everything but the two display fields alone", () => {
        const shown = localizePluginRegistryEntry(ENGLISH_FIRST, "zh");
        expect({ ...shown, name: ENGLISH_FIRST.name, description: ENGLISH_FIRST.description }).toEqual(ENGLISH_FIRST);
    });
});
