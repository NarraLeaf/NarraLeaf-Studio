// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingValueType } from "@/lib/settings/types";
import type { SettingCategory, SettingDescriptor } from "@/lib/settings/models";
import { SettingsExplorer } from "./SettingsExplorer";

vi.mock("../panels", () => ({ SETTING_PANELS: {} }));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(cleanup);

const category: SettingCategory = { key: "test", label: "Test", description: "", order: 0 };
const setting: SettingDescriptor = {
    id: "test.name",
    type: SettingValueType.String,
    label: "Name",
    description: "",
    defaultValue: "",
};

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

function TestSettings({ save, reset }: { save: (value: string) => Promise<void>; reset?: () => Promise<void> }) {
    const [stored, setStored] = useState("original");
    return (
        <SettingsExplorer
            categories={[category]}
            getSettingsForCategory={() => [setting]}
            describeSetting={entry => entry}
            getValue={() => stored}
            onCommit={async (_entry, _descriptor, value) => {
                await save(String(value));
                setStored(String(value));
            }}
            isModified={() => true}
            onReset={reset ? async () => { await reset(); setStored(""); } : undefined}
        />
    );
}

describe("settings field persistence", () => {
    it("keeps a newer draft while an earlier save finishes", async () => {
        const firstSave = deferred();
        const save = vi.fn(() => firstSave.promise);
        render(<TestSettings save={save} />);
        const input = screen.getByDisplayValue("original") as HTMLInputElement;

        fireEvent.change(input, { target: { value: "first" } });
        fireEvent.blur(input);
        await waitFor(() => expect(save).toHaveBeenCalledWith("first"));
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "second" } });
        await act(async () => { firstSave.resolve(); });

        expect(input.value).toBe("second");
    });

    it("writes once when Enter commits a focused field", async () => {
        const save = vi.fn(async () => undefined);
        render(<TestSettings save={save} />);
        const input = screen.getByDisplayValue("original");
        input.focus();
        fireEvent.change(input, { target: { value: "updated" } });
        fireEvent.keyDown(input, { key: "Enter" });

        await waitFor(() => expect(save).toHaveBeenCalled());
        await act(async () => { await Promise.resolve(); });
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("keeps focus and the draft when Enter confirms IME composition", async () => {
        const save = vi.fn(async () => undefined);
        render(<TestSettings save={save} />);
        const input = screen.getByDisplayValue("original");
        input.focus();
        fireEvent.change(input, { target: { value: "draft" } });
        fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
        await act(async () => { await Promise.resolve(); });

        expect(document.activeElement).toBe(input);
        expect(save).not.toHaveBeenCalled();
    });

    it("applies a reset after an earlier save completes", async () => {
        const firstSave = deferred();
        const save = vi.fn(() => firstSave.promise);
        const reset = vi.fn(async () => undefined);
        render(<TestSettings save={save} reset={reset} />);
        const input = screen.getByDisplayValue("original") as HTMLInputElement;

        fireEvent.change(input, { target: { value: "first" } });
        fireEvent.blur(input);
        await waitFor(() => expect(save).toHaveBeenCalledWith("first"));
        fireEvent.click(screen.getByRole("button", { name: "settings.resetToDefault" }));
        expect(reset).not.toHaveBeenCalled();
        await act(async () => { firstSave.resolve(); });

        await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
        expect(input.value).toBe("");
    });
});
