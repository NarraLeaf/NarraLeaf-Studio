// @vitest-environment jsdom
/**
 * The runtime bundle's `@/lib/i18n`: whatever shared widget code says through it is said in the shell's
 * language, which is the game's - and it follows a change made while the window is open, because a
 * language picked on a title screen applies without a restart.
 *
 * Imported by path: the vitest alias maps `@/lib/i18n` at Studio's own store, which is what the editor
 * runs and not what a shipped game does.
 *
 * Comments in English per project convention.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { getShellLocale, setShellGameLocale } from "../shellLocale";
import { i18nStore, translate, useTranslation } from "./i18n";

afterEach(() => {
    cleanup();
    setShellGameLocale(null);
    localStorage.clear();
});

function Title() {
    const { t } = useTranslation();
    return <h1>{t("game.crash.title")}</h1>;
}

describe("the runtime i18n shim", () => {
    it("speaks the game's language once the game has one", () => {
        setShellGameLocale("ja");
        expect(translate("game.crash.title")).toBe("ゲームが停止した");
        expect(i18nStore.getLocale()).toBe("ja");
        expect(i18nStore.getTranslator().locale).toBe("ja");
    });

    it("speaks the machine's language before that", () => {
        expect(getShellLocale()).toBe("en");
        expect(translate("game.crash.title")).toBe("The game stopped working");
    });

    it("redraws a component when the game's language changes", () => {
        setShellGameLocale("zh");
        render(<Title />);
        expect(screen.getByRole("heading").textContent).toBe("游戏已停止工作");
        act(() => setShellGameLocale("ja"));
        expect(screen.getByRole("heading").textContent).toBe("ゲームが停止した");
    });
});
