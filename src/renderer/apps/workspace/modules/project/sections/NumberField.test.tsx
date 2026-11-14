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

    it("stores the whole value entered in scientific notation", () => {
        const { field, onCommit } = mountField();

        act(() => field.focus());
        fireEvent.change(field, { target: { value: "1e2" } });
        act(() => field.blur());

        expect(onCommit).toHaveBeenCalledWith(100);
    });

    it("rejects a fractional value instead of storing its integer prefix", () => {
        const { field, onCommit } = mountField();

        act(() => field.focus());
        fireEvent.change(field, { target: { value: "15.5" } });
        act(() => field.blur());

        expect(onCommit).not.toHaveBeenCalled();
        expect(field.value).toBe("5");
    });

    it("restores an empty or out-of-range value", () => {
        const { field, onCommit } = mountField();

        for (const value of ["", "101"]) {
            act(() => field.focus());
            fireEvent.change(field, { target: { value } });
            act(() => field.blur());
            expect(field.value).toBe("5");
        }
        expect(onCommit).not.toHaveBeenCalled();
    });

    it("normalizes the displayed spelling when the value did not change", () => {
        const { field, onCommit } = mountField();
        act(() => field.focus());
        fireEvent.change(field, { target: { value: "05" } });
        act(() => field.blur());

        expect(field.value).toBe("5");
        expect(onCommit).not.toHaveBeenCalled();
    });

    it("keeps a new draft when an earlier write rolls back", () => {
        const onCommit = vi.fn();
        const { rerender } = render(<NumberField value={15} min={0} max={100} ariaLabel="Slots" onCommit={onCommit} />);
        const field = screen.getByLabelText("Slots") as HTMLInputElement;

        act(() => field.focus());
        fireEvent.change(field, { target: { value: "22" } });
        rerender(<NumberField value={5} min={0} max={100} ariaLabel="Slots" onCommit={onCommit} />);

        expect(field.value).toBe("22");
        act(() => field.blur());
        expect(onCommit).toHaveBeenCalledWith(22);
    });
});
