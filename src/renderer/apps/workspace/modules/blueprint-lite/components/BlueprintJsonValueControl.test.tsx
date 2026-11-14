// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlueprintJsonValueControl } from "./BlueprintJsonValueControl";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        tn: (key: string, count: number) => `${key}(${count})`,
        has: () => false,
        locale: "en",
    }),
}));

afterEach(cleanup);

function openEditor() {
    fireEvent.click(screen.getByRole("button", { name: "blueprint.json.edit" }));
}

describe("JSON tree editor", () => {
    it("keeps a temporarily empty number as a draft, then accepts a negative number", () => {
        const onChange = vi.fn();
        function Editor() {
            const [value, setValue] = useState<unknown>(12);
            return <BlueprintJsonValueControl value={value} onChange={next => { onChange(next); setValue(next); }} />;
        }
        render(<Editor />);
        openEditor();
        const input = screen.getByRole("spinbutton") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "" } });
        expect(onChange).not.toHaveBeenCalled();
        expect(input.value).toBe("");
        fireEvent.change(input, { target: { value: "-2" } });
        expect(onChange).toHaveBeenCalledWith(-2);
        expect(input.value).toBe("-2");
    });

    it("restores the stored number when an empty draft loses focus", () => {
        const onChange = vi.fn();
        render(<BlueprintJsonValueControl value={12} onChange={onChange} />);
        openEditor();
        const input = screen.getByRole("spinbutton") as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "" } });
        fireEvent.blur(input);
        expect(onChange).not.toHaveBeenCalled();
        expect(input.value).toBe("12");
    });

    it("treats a field named $ independently of the root expansion", () => {
        render(<BlueprintJsonValueControl value={{ $: { leaf: 1 } }} onChange={() => undefined} />);
        openEditor();
        expect(screen.getByDisplayValue("$")).not.toBeNull();
        expect(screen.queryByDisplayValue("leaf")).toBeNull();
        const row = screen.getByDisplayValue("$").closest(".flex.min-h-\\[28px\\]");
        expect(row).not.toBeNull();
        fireEvent.click(row!.querySelector('button[aria-label="common.expand"]')!);
        expect(screen.getByDisplayValue("leaf")).not.toBeNull();
        fireEvent.click(row!.querySelector('button[aria-label="common.collapse"]')!);
        expect(screen.queryByDisplayValue("leaf")).toBeNull();
        expect(screen.getByDisplayValue("$")).not.toBeNull();
    });

    it("expands a dotted key independently of the equivalent nested path", () => {
        render(<BlueprintJsonValueControl value={{ "a.b": { flat: 1 }, a: { b: { nested: 2 } } }} onChange={() => undefined} />);
        openEditor();
        const rowOf = (key: string) => screen.getByDisplayValue(key).closest(".flex.min-h-\\[28px\\]")!;
        fireEvent.click(rowOf("a").querySelector('button[aria-label="common.expand"]')!);
        fireEvent.click(rowOf("b").querySelector('button[aria-label="common.expand"]')!);
        expect(screen.getByDisplayValue("nested")).not.toBeNull();
        expect(screen.queryByDisplayValue("flat")).toBeNull();
        fireEvent.click(rowOf("a.b").querySelector('button[aria-label="common.expand"]')!);
        expect(screen.getByDisplayValue("flat")).not.toBeNull();
        expect(screen.getByDisplayValue("nested")).not.toBeNull();
    });
});
