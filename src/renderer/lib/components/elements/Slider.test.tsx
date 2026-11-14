// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Slider } from "./Slider";

afterEach(cleanup);

describe("Slider keyboard commits", () => {
    it("does not write a value when keyboard focus passes through", () => {
        const onCommit = vi.fn();
        render(<Slider aria-label="Volume" value={25} onValueCommit={onCommit} />);
        const slider = screen.getByRole("slider", { name: "Volume" });

        fireEvent.keyUp(slider, { key: "Tab" });
        fireEvent.keyUp(slider, { key: "Shift" });

        expect(onCommit).not.toHaveBeenCalled();
    });

    it.each(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"])(
        "commits when the %s value gesture ends",
        key => {
            const onCommit = vi.fn();
            render(<Slider aria-label="Volume" value={25} onValueCommit={onCommit} />);
            fireEvent.keyUp(screen.getByRole("slider", { name: "Volume" }), { key });
            expect(onCommit).toHaveBeenCalledWith(25);
        },
    );
});
