// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoFitFontSize } from "./useAutoFitFontSize";

let width = 300;
let height = 60;
let glyphSpan = 10;
let notifyResize: (() => void) | undefined;

function AutoFitText({ vertical, signature = "label" }: { vertical: boolean; signature?: string }) {
    const { boxRef, textRef, fontSize } = useAutoFitFontSize<HTMLDivElement, HTMLParagraphElement>({
        enabled: true,
        fontSize: 24,
        minFontSize: 8,
        vertical,
        signature,
    });
    const setBox = useCallback((node: HTMLDivElement | null) => {
        if (node) {
            Object.defineProperties(node, {
                clientWidth: { configurable: true, get: () => width },
                clientHeight: { configurable: true, get: () => height },
            });
        }
        boxRef(node);
    }, [boxRef]);
    const setText = useCallback((node: HTMLParagraphElement | null) => {
        if (node) {
            const size = () => parseFloat(node.style.fontSize);
            Object.defineProperties(node, {
                scrollWidth: { configurable: true, get: () => size() * (vertical ? 1 : glyphSpan) },
                scrollHeight: { configurable: true, get: () => size() * (vertical ? glyphSpan : 1) },
            });
        }
        textRef(node);
    }, [textRef, vertical]);
    return <div ref={setBox}><p ref={setText} style={{ fontSize }} data-testid="text">Label</p></div>;
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    notifyResize = undefined;
});

describe("text auto-fit when the containing box changes size", () => {
    it.each([false, true])("remeasures the inline axis (vertical: %s)", vertical => {
        width = vertical ? 60 : 300;
        height = vertical ? 300 : 60;
        glyphSpan = 10;
        vi.stubGlobal("ResizeObserver", class {
            constructor(callback: ResizeObserverCallback) {
                notifyResize = () => callback([], this as unknown as ResizeObserver);
            }
            observe() {}
            disconnect() {}
        });
        render(<AutoFitText vertical={vertical} />);
        const size = () => parseFloat(screen.getByTestId("text").style.fontSize);
        expect(size()).toBe(24);

        if (vertical) height = 150;
        else width = 150;
        act(() => notifyResize?.());
        expect(size()).toBeGreaterThan(14.5);
        expect(size()).toBeLessThanOrEqual(15.1);

        if (vertical) height = 300;
        else width = 300;
        act(() => notifyResize?.());
        expect(size()).toBe(24);
    });

    it("remeasures changed text when a hidden box returns to its previous size", () => {
        width = 300;
        height = 60;
        glyphSpan = 10;
        vi.stubGlobal("ResizeObserver", class {
            constructor(callback: ResizeObserverCallback) {
                notifyResize = () => callback([], this as unknown as ResizeObserver);
            }
            observe() {}
            disconnect() {}
        });
        const view = render(<AutoFitText vertical={false} />);
        const size = () => parseFloat(screen.getByTestId("text").style.fontSize);
        expect(size()).toBe(24);

        width = 0;
        act(() => notifyResize?.());
        glyphSpan = 20;
        view.rerender(<AutoFitText vertical={false} signature="longer label" />);
        width = 300;
        act(() => notifyResize?.());
        expect(size()).toBeGreaterThan(14.5);
        expect(size()).toBeLessThanOrEqual(15.1);
    });
});
