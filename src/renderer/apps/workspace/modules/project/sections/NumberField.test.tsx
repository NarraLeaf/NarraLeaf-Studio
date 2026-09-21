// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumberField } from "./NumberField";

afterEach(cleanup);

function mountField() {
    const onCommit = vi.fn();
    render(<NumberField value={5} min={0} max={100} ariaLabel="Slots" onCommit={onCommit} />);
    return { field: screen.getByLabelText("Slots") as HTMLInputElement, onCommit };
}

describe("NumberField", () => {
    it("stores what was typed when the author leaves the field", () => {
        const { field, onCommit } = mountField();

        act(() => field.focus());
        fireEvent.change(field, { target: { value: "15" } });
        act(() => field.blur());

        expect(onCommit).toHaveBeenCalledWith(15);
    });

    it("stores nothing when the author leaves it with Escape", () => {
        const { field, onCommit } = mountField();

        act(() => field.focus());
        fireEvent.change(field, { target: { value: "15" } });
        // Escape blurs the field itself. The blur is what commits, and it runs before the reset
        // draft has rendered - so this is the edit that used to be stored anyway.
        act(() => { fireEvent.keyDown(field, { key: "Escape" }); });

        expect(onCommit).not.toHaveBeenCalled();
        expect(field.value).toBe("5");

        // And the next edit is not swallowed by the Escape before it.
        act(() => field.focus());
        fireEvent.change(field, { target: { value: "7" } });
        act(() => field.blur());
        expect(onCommit).toHaveBeenCalledWith(7);
    });
});
