import { describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import type { DependencyResolutionEntry } from "@shared/types/pluginDependencies";
import { listUnmetPluginNames } from "./useDependencyOffer";

function unmet(id: string, name: string, localized?: DependencyResolutionEntry["installedLocalized"]): DependencyResolutionEntry {
    return {
        dependency: { id, name, builtIn: true, authoredVersion: "1.0.0", hard: true, usedBy: {} },
        installedVersion: "1.0.0",
        installedEnabled: false,
        installedLocalized: localized,
        status: "satisfied",
        suppressed: false,
    };
}

const GALLERY = unmet("narraleaf.gallery", "Gallery", { zh: { name: "画廊" }, ja: { name: "ギャラリー" } });
const QUICK_SAVE = unmet("narraleaf.quick-save", "Quick Save", { zh: { name: "快速存档" }, ja: { name: "クイックセーブ" } });

describe("the plugins the missing-plugin warning names", () => {
    it.each([
        ["zh", "画廊、快速存档"],
        ["ja", "ギャラリー、クイックセーブ"],
        ["en", "Gallery, Quick Save"],
    ] as const)("are joined the way %s writes a list", (locale, expected) => {
        expect(listUnmetPluginNames([GALLERY, QUICK_SAVE], createTranslator(locale))).toBe(expected);
    });

    it("names one plugin on its own", () => {
        expect(listUnmetPluginNames([GALLERY], createTranslator("zh"))).toBe("画廊");
    });

    it("stops at four names with no closing 'and', so a longer list does not read as complete", () => {
        const many = ["A", "B", "C", "D", "E"].map(name => unmet(`example.${name}`, name));
        expect(listUnmetPluginNames(many, createTranslator("en"))).toBe("A, B, C, D");
        expect(listUnmetPluginNames(many, createTranslator("zh"))).toBe("A、B、C、D");
    });
});
