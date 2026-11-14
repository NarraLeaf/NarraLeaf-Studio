// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostVisibility } from "@/lib/components/layout";
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

describe("JSON editor in a kept-alive blueprint", () => {
    it("hides an invalid draft without losing it or capturing keys in another tab", () => {
        const onChange = vi.fn();
        const editor = (visible: boolean) => (
            <HostVisibility visible={visible}>
                <BlueprintJsonValueControl value={{ x: 1 }} onChange={onChange} />
            </HostVisibility>
        );
        const view = render(editor(true));
        fireEvent.click(screen.getByRole("button", { name: "blueprint.json.edit" }));
        fireEvent.click(screen.getByRole("button", { name: "blueprint.json.rawJson" }));
        fireEvent.change(screen.getByRole("textbox"), { target: { value: '{"x":' } });

        view.rerender(editor(false));
        expect(screen.queryByRole("textbox")).toBeNull();
        expect(fireEvent.keyDown(document, { key: "Escape", cancelable: true })).toBe(true);
        expect(onChange).not.toHaveBeenCalled();

        view.rerender(editor(true));
        expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe('{"x":');
        fireEvent.change(screen.getByRole("textbox"), { target: { value: '{"x":2}' } });
        fireEvent.blur(screen.getByRole("textbox"));
        expect(onChange).toHaveBeenCalledWith({ x: 2 });
    });

    it("commits a valid draft and closes when its editor is hidden", () => {
        const onChange = vi.fn();
        const editor = (visible: boolean) => (
            <HostVisibility visible={visible}>
                <BlueprintJsonValueControl value={{ x: 1 }} onChange={onChange} />
            </HostVisibility>
        );
        const view = render(editor(true));
        fireEvent.click(screen.getByRole("button", { name: "blueprint.json.edit" }));
        fireEvent.click(screen.getByRole("button", { name: "blueprint.json.rawJson" }));
        fireEvent.change(screen.getByRole("textbox"), { target: { value: '{"x":2}' } });
        view.rerender(editor(false));
        expect(onChange).toHaveBeenCalledWith({ x: 2 });
        view.rerender(editor(true));
        expect(screen.queryByRole("textbox")).toBeNull();
    });
});
