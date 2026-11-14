// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingFontPicker } from "./SettingFontPicker";

const fonts = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("@/lib/settings/systemFonts", () => ({ loadSystemFontFamilies: fonts.load }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, has: () => false, tn: (key: string) => key, locale: "en" }),
}));

afterEach(() => {
    cleanup();
    fonts.load.mockReset();
});

function openPicker() {
    const onChange = vi.fn();
    render(
        <SettingFontPicker
            value="Selected Font"
            presets={["default"]}
            presetStacks={{ default: "sans-serif" }}
            onChange={onChange}
            ariaLabel="Font"
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Font" }));
    return { onChange, search: screen.getByPlaceholderText("settings.fontPicker.searchPlaceholder") };
}

describe("SettingFontPicker", () => {
    it("keeps the selected family active while installed fonts are loading", () => {
        fonts.load.mockReturnValue(new Promise(() => {}));
        const { onChange, search } = openPicker();

        fireEvent.keyDown(search, { key: "Enter" });
        expect(onChange).not.toHaveBeenCalled();
    });

    it.each([
        ["is missing", { status: "ok", families: [] }],
        ["cannot be enumerated", { status: "denied" }],
        ["is installed", { status: "ok", families: [{ family: "Selected Font", aliases: [] }] }],
    ])("keeps the selected family active after the font list arrives when it %s", async (_description, result) => {
        let resolve!: (result: unknown) => void;
        fonts.load.mockReturnValue(new Promise(done => { resolve = done; }));
        const { onChange, search } = openPicker();

        await act(async () => { resolve(result); });

        fireEvent.keyDown(search, { key: "Enter" });
        expect(onChange).not.toHaveBeenCalled();
    });
});
