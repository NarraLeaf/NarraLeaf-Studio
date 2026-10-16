// @vitest-environment jsdom
/**
 * A determinate bar shows a figure, and a figure that pulses reads as something still loading. The
 * voice and translation coverage bars sat on a panel pulsing for as long as it was open, because the
 * pulse was the default and only those two callers took it.
 */
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Progress } from "./Progress";

afterEach(cleanup);

function fill(container: HTMLElement): HTMLElement {
    const bar = container.querySelector<HTMLElement>("[style*='width']");
    if (!bar) {
        throw new Error("no fill rendered");
    }
    return bar;
}

describe("Progress", () => {
    it("is still unless asked to pulse", () => {
        const { container } = render(<Progress value={2} max={37} size="sm" />);
        expect(fill(container).className).not.toContain("animate-pulse");
    });

    it("pulses when the caller asks for it", () => {
        const { container } = render(<Progress value={2} max={37} animated />);
        expect(fill(container).className).toContain("animate-pulse");
    });
});
