/**
 * What a text's new Blueprint Value is called.
 *
 * It was "{name} text" whatever the text was called, and a new text is called Text, so the
 * blueprint made for it read "Text text" (zh 「文本 文本」). A text still called by its kind's name
 * names the blueprint as its tab does; a renamed one keeps its name in front.
 *
 * Comments in English per project convention.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { i18nStore } from "@/lib/i18n/store";
import { translate } from "@/lib/i18n";
import { TEXT_BLUEPRINT_VALUE_CONFIG } from "./TextSourceField";

function nameFor(name: string | undefined): string {
    const liveElement = { id: "text", type: "nl.text", name, props: { text: "Hello" } } as unknown as UIElement;
    return TEXT_BLUEPRINT_VALUE_CONFIG.getDisplayName({ liveElement, data: {} as UIInspectorData });
}

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("a text's Blueprint Value name", () => {
    for (const locale of ["en", "zh", "ja"] as const) {
        it(`does not repeat the kind's name in ${locale}`, () => {
            i18nStore.setLocale(locale);
            const kindName = translate("widgets.defaults.text.name");
            const title = translate("widgets.blueprintValue.textTitle");
            expect(nameFor(kindName)).toBe(title);
            expect(nameFor(undefined)).toBe(title);
            expect(nameFor("Clears")).toBe(translate("widgets.blueprintValue.nameText", { name: "Clears" }));
        });
    }

    it("reads as the tab does", () => {
        i18nStore.setLocale("zh");
        expect(nameFor("文本")).toBe("文本值");
        expect(nameFor("通关次数")).toBe("通关次数 文本");
        i18nStore.setLocale("en");
        expect(nameFor("Text")).toBe("Text Value");
    });
});
