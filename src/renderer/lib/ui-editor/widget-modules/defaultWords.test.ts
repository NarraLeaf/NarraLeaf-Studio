import { afterEach, describe, expect, it } from "vitest";
import { i18nStore } from "@/lib/i18n";
import { ChoiceListWidgetModule } from "./builtin/choiceList";
import { DialogSentenceWidgetModule } from "./builtin/dialog";
import { ButtonWidgetModule } from "./builtin/button";
import { TextWidgetModule } from "./builtin/text";
import { widgetDefaultWordsFor } from "./defaultWords";

/**
 * A new widget's player-facing words are in the project's source language; its name, which only the
 * author reads, stays in the interface's language.
 */

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("widgetDefaultWordsFor", () => {
    it("reads the catalogue of the project's source language, matched as a language tag", () => {
        expect(widgetDefaultWordsFor("zh").t("widgets.defaults.text.text")).toBe("文本");
        expect(widgetDefaultWordsFor("zh-CN").t("widgets.defaults.button.label")).toBe("按钮");
        expect(widgetDefaultWordsFor("ja-JP").t("widgets.defaults.text.text")).toBe("テキスト");
        expect(widgetDefaultWordsFor("en").t("widgets.defaults.text.text")).toBe("Text");
    });

    it("keeps the interface's language for a project in a language Studio has no catalogue for, or none", () => {
        i18nStore.setLocale("ja");
        expect(widgetDefaultWordsFor("fr").t("widgets.defaults.text.text")).toBe("テキスト");
        expect(widgetDefaultWordsFor("").t("widgets.defaults.text.text")).toBe("テキスト");
        expect(widgetDefaultWordsFor(undefined).t("widgets.defaults.text.text")).toBe("テキスト");
    });
});

describe("a new widget's default element", () => {
    it("writes a text's and a button's words in the given language and names them in the interface's", () => {
        const zh = widgetDefaultWordsFor("zh");
        const text = TextWidgetModule.createDefaultElement(zh);
        expect(text.props?.text).toBe("文本");
        expect(text.name).toBe("Text");
        const button = ButtonWidgetModule.createDefaultElement(zh);
        expect(button.props?.label).toBe("按钮");
        expect(button.name).toBe("Button");
    });

    it("hands the language to a specialisation and its rows, through the parent it extends", () => {
        const zh = widgetDefaultWordsFor("zh");
        expect(DialogSentenceWidgetModule.createDefaultElement(zh).props?.text).toBe("当前对白将显示在此处");
        const items = ChoiceListWidgetModule.createDefaultElement(zh).props?.items as { text: string }[];
        expect(items.map(item => item.text)).toEqual(["选项 A", "选项 B", "选项 C"]);
    });

    it("uses the interface's language when no language is given", () => {
        i18nStore.setLocale("zh");
        expect(TextWidgetModule.createDefaultElement().props?.text).toBe("文本");
    });
});
