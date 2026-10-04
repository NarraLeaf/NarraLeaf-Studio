// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingSourcePicker } from "./SettingSourcePicker";

/**
 * The source picker's keyboard. Its last row is a field, which gives Escape and Tab different jobs:
 * Escape leaves without what was typed, while Tab out keeps it - the same as the blur that keeps
 * what was typed in every other field of the settings window.
 */

vi.mock("@/lib/i18n", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        has: () => false,
        tn: (key: string) => key,
        locale: "en",
    }),
}));

afterEach(cleanup);

const PRESETS = ["", "https://mirror.example/"] as const;
const LABELS = { "": "Official", "https://mirror.example/": "Mirror" };

function mount(value = "") {
    const onChange = vi.fn<(next: string) => void>();
    render(
        <>
            <SettingSourcePicker value={value} presets={PRESETS} presetLabels={LABELS} onChange={onChange} ariaLabel="Source" />
            <button type="button">after</button>
        </>,
    );
    const trigger = screen.getByRole("button", { name: "Source" });
    trigger.focus();
    fireEvent.click(trigger);
    return { onChange, trigger };
}

function field(): HTMLInputElement {
    return screen.getByPlaceholderText("settings.source.customPlaceholder") as HTMLInputElement;
}

describe("SettingSourcePicker", () => {
    it("opens with focus in the address field", () => {
        mount();
        expect(document.activeElement).toBe(field());
    });

    it("drops a typed address on Escape and gives focus back to the trigger", () => {
        const { onChange, trigger } = mount();
        fireEvent.change(field(), { target: { value: "https://typed.example/" } });
        fireEvent.keyDown(field(), { key: "Escape" });

        expect(screen.queryByPlaceholderText("settings.source.customPlaceholder")).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);
    });

    it("keeps a typed address when Tab takes focus out", () => {
        const { onChange } = mount();
        fireEvent.change(field(), { target: { value: "https://typed.example/" } });
        fireEvent.keyDown(field(), { key: "Tab" });

        expect(screen.queryByPlaceholderText("settings.source.customPlaceholder")).toBeNull();
        expect(onChange).toHaveBeenCalledWith("https://typed.example/");
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "after" }));
    });

    it("walks the offered rows from the field and picks one with Enter", () => {
        const { onChange, trigger } = mount();
        fireEvent.keyDown(field(), { key: "ArrowUp" });
        const mirror = screen.getByRole("option", { name: "Mirror" });
        expect(document.activeElement).toBe(mirror);

        fireEvent.keyDown(mirror, { key: "ArrowUp" });
        expect(document.activeElement).toBe(screen.getByRole("option", { name: "Official" }));

        fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });

        expect(onChange).toHaveBeenCalledWith("https://mirror.example/");
        expect(screen.queryByRole("option")).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });
});
