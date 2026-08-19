// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TitleBarMenus, useTitleBarMenu } from "./titleBarMenus";

/**
 * What makes a row of menus read as a menu bar rather than as three independent popups.
 *
 * Two rules, and each has a way of regressing that looks like nothing on screen until an author hits
 * it: menus stacking up because every one of them kept its own boolean, and the pointer walking onto
 * a control that was never a menu in the first place.
 */

function Menu({ id, label, hotTrack = false }: { id: string; label: string; hotTrack?: boolean }) {
    const menu = useTitleBarMenu(id, { hotTrack });
    return (
        <div ref={menu.ref}>
            <button onClick={menu.toggle} {...menu.triggerProps}>{label}</button>
            {menu.open && <div role="menu" aria-label={`${label} menu`} />}
        </div>
    );
}

/** An action group, a second action group, and a control that merely carries a menu. */
function renderBar() {
    render(
        <TitleBarMenus>
            <Menu id="file" label="File" hotTrack />
            <Menu id="help" label="Help" hotTrack />
            <Menu id="switcher" label="Project" />
        </TitleBarMenus>,
    );
}

/** Whatever is on screen, by name. */
function onScreen(): (string | null)[] {
    return screen.queryAllByRole("menu").map(menu => menu.getAttribute("aria-label"));
}

function trigger(label: string): HTMLElement {
    return screen.getByRole("button", { name: label });
}

/** React derives `pointerenter` from `pointerover`; dispatching the enter itself reaches nothing. */
function slideOnto(label: string): void {
    fireEvent.pointerOver(trigger(label));
}

afterEach(cleanup);

describe("the title bar's menus", () => {
    it("puts away the open menu when another one is clicked", () => {
        renderBar();

        fireEvent.click(trigger("File"));
        expect(onScreen()).toEqual(["File menu"]);

        fireEvent.click(trigger("Help"));
        expect(onScreen()).toEqual(["Help menu"]);
    });

    it("hands the pointer from one action group to the next, with no second click", () => {
        renderBar();
        fireEvent.click(trigger("File"));

        slideOnto("Help");

        expect(onScreen()).toEqual(["Help menu"]);
    });

    it("stays shut for a pointer crossing a bar that has nothing open", () => {
        renderBar();

        slideOnto("Help");

        expect(onScreen()).toEqual([]);
    });

    it("leaves the controls that merely carry a menu out of the chain", () => {
        renderBar();
        fireEvent.click(trigger("File"));

        slideOnto("Project");

        // Crossing the project switcher on the way to a window control is not a request to see the
        // project list - and it is not a reason to drop the menu the author did open either.
        expect(onScreen()).toEqual(["File menu"]);
    });

    it("does not walk out of them either", () => {
        renderBar();
        fireEvent.click(trigger("Project"));

        slideOnto("File");

        expect(onScreen()).toEqual(["Project menu"]);
    });

    it("closes on a pointer landing anywhere else", () => {
        renderBar();
        fireEvent.click(trigger("File"));

        fireEvent.pointerDown(document.body);

        expect(onScreen()).toEqual([]);
    });

    it("works on its own, for a menu that has no bar around it", () => {
        render(<Menu id="lonely" label="File" hotTrack />);

        fireEvent.click(trigger("File"));
        expect(onScreen()).toEqual(["File menu"]);

        fireEvent.pointerDown(document.body);
        expect(onScreen()).toEqual([]);
    });
});
