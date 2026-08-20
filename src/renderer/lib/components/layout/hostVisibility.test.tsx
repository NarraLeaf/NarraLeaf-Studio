// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostVisibility, useDismissWhenHidden } from "./hostVisibility";

/**
 * Kept-alive tabs and panels go behind `display: none` rather than unmounting, and a popup they
 * portalled to the document body is not inside that box - so it stays on screen, over whatever the
 * author switched to. This is the signal that puts it away, and the ways it can go wrong are: never
 * arriving, arriving at a host that had nothing open, and arriving again on every later render.
 */

function Layer({ dismiss, open }: { dismiss: () => void; open?: boolean }) {
    useDismissWhenHidden(dismiss, open);
    return null;
}

afterEach(cleanup);

describe("a layer whose host is put away", () => {
    it("is dismissed when the host stops being the one on screen", () => {
        const dismiss = vi.fn();
        const view = render(<HostVisibility visible><Layer dismiss={dismiss} /></HostVisibility>);
        expect(dismiss).not.toHaveBeenCalled();

        view.rerender(<HostVisibility visible={false}><Layer dismiss={dismiss} /></HostVisibility>);
        expect(dismiss).toHaveBeenCalledTimes(1);
    });

    it("is left alone while the host is showing", () => {
        const dismiss = vi.fn();
        const view = render(<HostVisibility visible><Layer dismiss={dismiss} /></HostVisibility>);

        view.rerender(<HostVisibility visible><Layer dismiss={dismiss} /></HostVisibility>);

        expect(dismiss).not.toHaveBeenCalled();
    });

    it("says nothing for a host that had nothing open", () => {
        const dismiss = vi.fn();
        const view = render(<HostVisibility visible><Layer dismiss={dismiss} open={false} /></HostVisibility>);

        view.rerender(<HostVisibility visible={false}><Layer dismiss={dismiss} open={false} /></HostVisibility>);

        expect(dismiss).not.toHaveBeenCalled();
    });

    it("dismisses once, not again on every later render", () => {
        const dismiss = vi.fn();
        const view = render(<HostVisibility visible><Layer dismiss={dismiss} /></HostVisibility>);
        view.rerender(<HostVisibility visible={false}><Layer dismiss={dismiss} /></HostVisibility>);

        // A fresh callback each render is the normal case at the call sites; it must not re-fire.
        view.rerender(<HostVisibility visible={false}><Layer dismiss={() => dismiss()} /></HostVisibility>);

        expect(dismiss).toHaveBeenCalledTimes(1);
    });

    it("stays hidden when an inner host says it is showing", () => {
        // The selected panel of a stack is still not on screen while the sidebar is collapsed.
        const dismiss = vi.fn();
        const tree = (outer: boolean) => (
            <HostVisibility visible={outer}>
                <HostVisibility visible>
                    <Layer dismiss={dismiss} />
                </HostVisibility>
            </HostVisibility>
        );
        const view = render(tree(true));
        view.rerender(tree(false));

        expect(dismiss).toHaveBeenCalledTimes(1);
    });

    it("leaves a component used outside any host exactly as it was", () => {
        const dismiss = vi.fn();
        const view = render(<Layer dismiss={dismiss} />);

        view.rerender(<Layer dismiss={dismiss} />);

        expect(dismiss).not.toHaveBeenCalled();
    });
});
