// @vitest-environment jsdom
/**
 * The words field a plugin's own editor uses: the same choice Studio's text and button labels offer,
 * held by whoever passes the value. Words written directly commit as words; leaving a key keeps what
 * the key said, so switching where the words come from does not change them.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { i18nStore } from "@/lib/i18n";
import { setDesignTimeLocalizationKeys } from "@/lib/ui-editor/runtime/localization/designTimeKeys";
import { WordsSourceField } from "./WordsSourceField";

afterEach(() => {
    cleanup();
    setDesignTimeLocalizationKeys(null);
});

function segment(name: string): HTMLElement {
    return screen.getByRole("button", { name });
}

describe("the words field", () => {
    it("offers the two sources a text's words have, in Studio's words", () => {
        render(<WordsSourceField value={{ text: "Save", key: null }} onChange={() => undefined} />);
        const { t } = i18nStore.getTranslator();
        expect(segment(t("widgets.localization.direct"))).toBeTruthy();
        expect(segment(t("widgets.localization.translationKey"))).toBeTruthy();
        expect(screen.queryByRole("button", { name: t("widgetChrome.blueprint.blueprintValue") })).toBeNull();
    });

    it("commits words written directly as words, with no key", () => {
        const onChange = vi.fn();
        render(<WordsSourceField value={{ text: "Save", key: null }} onChange={onChange} />);
        const box = screen.getByDisplayValue("Save");
        fireEvent.change(box, { target: { value: "Save game" } });
        fireEvent.blur(box);
        expect(onChange).toHaveBeenLastCalledWith({ text: "Save game", key: null });
    });

    it("shows a key's source words, and leaving the key keeps them as the words written directly", () => {
        setDesignTimeLocalizationKeys({ "menu.save": "Save your game" });
        const onChange = vi.fn();
        render(<WordsSourceField value={{ text: "Save", key: "menu.save" }} onChange={onChange} />);
        expect(screen.getByDisplayValue("Save your game")).toBeTruthy();
        fireEvent.click(segment(i18nStore.getTranslator().t("widgets.localization.direct")));
        expect(onChange).toHaveBeenLastCalledWith({ text: "Save your game", key: null });
    });

    it("writes nothing when the key choice is picked before a key is", () => {
        const onChange = vi.fn();
        render(<WordsSourceField value={{ text: "Save", key: null }} onChange={onChange} />);
        fireEvent.click(segment(i18nStore.getTranslator().t("widgets.localization.translationKey")));
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.queryByDisplayValue("Save")).toBeNull();
    });
});
