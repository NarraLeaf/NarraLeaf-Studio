// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorPickerTrigger } from "./ColorPickerField";

/**
 * What closing the panel writes, and what the trigger shows while it is open.
 *
 * Both answer the same complaint from two directions: the panel is where a colour is BUILT, and the
 * trigger outside it is showing what the caller has STORED. Opening the panel and closing it again
 * moved nothing, so nothing should be stored; and while it is open the trigger has to follow what is
 * being built, or the author judges a new colour against the old one sitting beside it.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

vi.mock("./brandPalette", () => ({
    useBrandPalette: () => ({ list: () => [], resolveCss: () => null }),
    useBrandColorLabel: () => (color: { id: string }) => color.id,
}));

// jsdom has no layout, so the panel's own resize watcher has nothing to observe. Stubbed rather
// than worked around: what is under test is what the panel writes, not where it is placed.
globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const trigger = () => screen.getByRole("button", { name: "Accent" });

describe("closing the colour panel", () => {
    it("writes nothing when the author only looked", () => {
        const onCommit = vi.fn();
        render(
            <ColorPickerTrigger
                value={{ hex: "#40A8C4", alpha: 1 }}
                ariaLabel="Accent"
                onChange={() => undefined}
                onCommit={onCommit}
            />,
        );

        fireEvent.click(trigger());
        fireEvent.click(trigger());

        // A field that stores "no colour" as an absent value opens the panel on a starting point for
        // the eye. Committing that on the way out is how a character with no accent acquired one.
        expect(onCommit).not.toHaveBeenCalled();
    });

    it("writes once when the author picked a colour", () => {
        const onCommit = vi.fn();
        render(
            <ColorPickerTrigger
                value={{ hex: "#40A8C4", alpha: 1 }}
                ariaLabel="Accent"
                colorModes={["hex"]}
                onChange={() => undefined}
                onCommit={onCommit}
            />,
        );

        fireEvent.click(trigger());
        const hexInput = screen.getByDisplayValue("#40A8C4");
        fireEvent.change(hexInput, { target: { value: "#FF0000" } });
        fireEvent.blur(hexInput);
        fireEvent.click(trigger());

        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit.mock.calls[0][0]).toMatchObject({ hex: "#FF0000" });
    });
});

describe("a bare swatch trigger", () => {
    it("paints nothing of its own while the panel is closed, and the panel's colour while it is open", () => {
        render(
            <ColorPickerTrigger
                value={{ hex: "#40A8C4", alpha: 1 }}
                displayMode="swatch"
                ariaLabel="Accent"
                onChange={() => undefined}
            />,
        );

        // Closed: the caller's frame is what paints, which is what lets the settings window show a
        // hue wheel behind this button meaning "pick anything".
        expect(trigger().style.backgroundColor).toBe("");

        fireEvent.click(trigger());
        expect(trigger().style.backgroundColor).not.toBe("");
    });
});
