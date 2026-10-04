// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    SurfaceToolbarPopoverPanel,
    SurfaceToolbarPopoverRow,
    useSurfaceToolbarPopover,
} from "./SurfaceEditorToolbarPopover";

afterEach(cleanup);

function ZoomLikeMenu({ selected }: { selected: string }) {
    const popover = useSurfaceToolbarPopover();
    return (
        <>
            <button type="button" ref={popover.triggerRef} onClick={popover.toggle}>
                Open
            </button>
            <SurfaceToolbarPopoverPanel popover={popover}>
                {["Fit", "Fill", "Actual"].map(label => (
                    <SurfaceToolbarPopoverRow
                        key={label}
                        label={label}
                        selected={label === selected}
                        onClick={popover.close}
                    />
                ))}
            </SurfaceToolbarPopoverPanel>
        </>
    );
}

/**
 * Every canvas toolbar dropdown in the surface and blueprint editors is this one popover, so the
 * keyboard contract is pinned once here rather than per menu: it opens on the row already chosen,
 * the arrows walk the rows, and Escape closes it - without the editor it was portalled out of hearing
 * the key - and gives focus back to the trigger.
 */
describe("surface toolbar popover keyboard", () => {
    it("opens on the chosen row and walks the rows with the arrows", () => {
        render(<ZoomLikeMenu selected="Fill" />);
        fireEvent.click(screen.getByText("Open"));

        expect(document.activeElement?.textContent).toBe("Fill");
        fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
        expect(document.activeElement?.textContent).toBe("Actual");
        fireEvent.keyDown(document.activeElement!, { key: "Home" });
        expect(document.activeElement?.textContent).toBe("Fit");
    });

    it("closes on Escape without the editor hearing it, and focus returns to the trigger", () => {
        const editorEscape = vi.fn();
        render(
            <div onKeyDown={event => event.key === "Escape" && editorEscape()}>
                <ZoomLikeMenu selected="Fit" />
            </div>,
        );
        const trigger = screen.getByText("Open");
        trigger.focus();
        fireEvent.click(trigger);
        expect(screen.getByText("Actual")).toBeTruthy();

        fireEvent.keyDown(document.activeElement!, { key: "Escape" });

        expect(screen.queryByText("Actual")).toBeNull();
        expect(editorEscape).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);
    });
});
