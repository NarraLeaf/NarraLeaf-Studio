import { describe, expect, it } from "vitest";
import { keysOnlyLocalization, type GameLocalizationBundle } from "@shared/types/localization";
import { requireUITextSite, resolveUITextWords } from "@shared/types/ui-editor/textSource";
import { resolveLocalizationKeyText } from "@/lib/ui-editor/blueprint-nodes/built-in/localizationKeyText";

/**
 * A key is shared words before it is a translation: a project without a source language reads its
 * keys like any other project, and every reader of a key gives the same answer - a keyed widget, the
 * latent `Get Text` and the pure `Translation Key Text` - including for a key the project does not
 * have, which reads as its name.
 */

const TEXT = requireUITextSite("nl.text");

const translated: GameLocalizationBundle = {
    sourceLocale: "en",
    locales: [{ code: "en", displayName: "English" }, { code: "zh-CN", displayName: "简体中文" }],
    tables: { "zh-CN": { "key:menu.start": "开始" } },
    keys: { "menu.start": "Start" },
};

const keysOnly = keysOnlyLocalization({ "menu.start": "Start" });

/** A keyed widget's words, the way a running game draws them. */
function widget(bundle: GameLocalizationBundle, locale: string, key: string): string {
    return resolveUITextWords({ site: TEXT, elementId: "t", sourceText: "", localizationKey: key }, { kind: "game", bundle, locale });
}

/** A blueprint's reading of a key; an unknown key is shown as its name, as both key nodes show it. */
function blueprint(bundle: GameLocalizationBundle, locale: string, key: string): string {
    return resolveLocalizationKeyText(bundle, locale, key) ?? key;
}

describe("keys in a project without a source language", () => {
    it("read as their source words, in a widget and in a blueprint alike", () => {
        expect(widget(keysOnly, "", "menu.start")).toBe("Start");
        expect(blueprint(keysOnly, "", "menu.start")).toBe("Start");
    });

    it("read a key the project does not have as its name, in a widget and in a blueprint alike", () => {
        expect(widget(keysOnly, "", "menu.gone")).toBe("menu.gone");
        expect(blueprint(keysOnly, "", "menu.gone")).toBe("menu.gone");
        expect(widget(translated, "zh-CN", "menu.gone")).toBe("menu.gone");
        expect(blueprint(translated, "zh-CN", "menu.gone")).toBe("menu.gone");
    });

    it("leave a translated project's keys reading as they did", () => {
        for (const locale of ["en", "zh-CN"]) {
            expect(widget(translated, locale, "menu.start")).toBe(blueprint(translated, locale, "menu.start"));
        }
        expect(widget(translated, "zh-CN", "menu.start")).toBe("开始");
    });
});
