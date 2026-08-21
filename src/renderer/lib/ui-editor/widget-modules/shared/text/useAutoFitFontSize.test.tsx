// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
    findLargestFittingSize,
    useAutoFitFontSize,
} from "@/lib/ui-editor/widget-modules/shared/text/useAutoFitFontSize";

/**
 * Auto fit answers one question - what is the largest size at which the whole text still fits its
 * box - so that is what these check: the search itself, and that the answer reaches the element.
 *
 * jsdom lays nothing out, so the box and the text are given a layout of their own: a box of a fixed
 * height, and text whose height is its line count at the size being tried. That is enough to tell a
 * search that converges on the right size from one that stops a step early, overshoots the ceiling,
 * or ignores the floor.
 */

const BOX_HEIGHT = 60;
const BOX_WIDTH = 200;
/** Three lines of text, so the box holds it only at 20px or less. */
const LINES = 3;

function stubLayout() {
    const define = (proto: object, key: string, get: (element: HTMLElement) => number) => {
        Object.defineProperty(proto, key, {
            configurable: true,
            get(this: HTMLElement) {
                return get(this);
            },
        });
    };
    define(HTMLDivElement.prototype, "clientHeight", () => BOX_HEIGHT);
    define(HTMLDivElement.prototype, "clientWidth", () => BOX_WIDTH);
    define(HTMLParagraphElement.prototype, "scrollHeight", element => {
        const size = parseFloat(element.style.fontSize) || 16;
        return size * LINES;
    });
    define(HTMLParagraphElement.prototype, "scrollWidth", () => BOX_WIDTH);
}

function Harness({ fontSize, minFontSize }: { fontSize: number; minFontSize: number }) {
    const { boxRef, textRef, fontSize: fitted } = useAutoFitFontSize<HTMLDivElement, HTMLParagraphElement>({
        enabled: true,
        fontSize,
        minFontSize,
        vertical: false,
        signature: "line",
    });
    return (
        <div ref={boxRef}>
            <p ref={textRef} style={{ fontSize: fitted }} data-testid="text">
                A line long enough to wrap.
            </p>
        </div>
    );
}

function renderedFontSize(fontSize: number, minFontSize: number): number {
    const view = render(<Harness fontSize={fontSize} minFontSize={minFontSize} />);
    const text = view.getByTestId("text");
    return parseFloat(text.style.fontSize);
}

afterEach(() => {
    cleanup();
});

describe("findLargestFittingSize", () => {
    it("keeps the authored size when the text already fits", () => {
        expect(findLargestFittingSize(12, 24, () => true)).toBe(24);
    });

    it("stops at the floor when nothing in the range fits", () => {
        expect(findLargestFittingSize(12, 24, () => false)).toBe(12);
    });

    it("converges just under the largest size that fits", () => {
        const limit = 17.3;
        const found = findLargestFittingSize(8, 32, size => size <= limit);
        expect(found).toBeLessThanOrEqual(limit);
        expect(found).toBeGreaterThan(limit - 0.5);
    });

    it("never returns more than the ceiling", () => {
        expect(findLargestFittingSize(30, 24, () => true)).toBe(24);
    });
});

describe("useAutoFitFontSize", () => {
    it("sets the text down to the largest size its box holds", () => {
        stubLayout();
        const fitted = renderedFontSize(32, 8);
        expect(fitted).toBeLessThanOrEqual(BOX_HEIGHT / LINES);
        expect(fitted).toBeGreaterThan(BOX_HEIGHT / LINES - 0.5);
    });

    it("leaves the authored size alone when it already fits", () => {
        stubLayout();
        expect(renderedFontSize(16, 8)).toBe(16);
    });

    it("goes no smaller than the floor, and leaves the rest overflowing", () => {
        stubLayout();
        expect(renderedFontSize(32, 24)).toBe(24);
    });
});
