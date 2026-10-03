// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, useContextMenu, type ContextMenuDef } from "./ContextMenu";

afterEach(cleanup);

const ITEMS: ContextMenuDef = [{ id: "one", label: "One" }];

function openMenus(): number {
    return document.querySelectorAll('[data-context-menu="true"]').length;
}

/** A surface with a menu of its own, as every right-click surface in Studio is built. */
function MenuSurface({ label, children }: { label: string; children?: React.ReactNode }) {
    const { menuState, showMenu, hideMenu } = useContextMenu();
    return (
        <div data-testid={label} onContextMenu={showMenu}>
            {children}
            <ContextMenu
                items={[{ id: label, label }]}
                position={menuState.position}
                visible={menuState.visible}
                onClose={hideMenu}
            />
        </div>
    );
}

/** Two menus that a caller opens on its own, outside any right click. */
function TwoMenus() {
    const [first, setFirst] = useState(true);
    const [second, setSecond] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setSecond(true)}>open second</button>
            {first ? <ContextMenu items={ITEMS} position={{ x: 1, y: 1 }} onClose={() => setFirst(false)} /> : null}
            {second ? <ContextMenu items={ITEMS} position={{ x: 2, y: 2 }} onClose={() => setSecond(false)} /> : null}
        </>
    );
}

/**
 * One right click is one menu. A surface with a menu inside another surface with a menu used to open
 * both at the same point; choosing a row closed the top one, and the one underneath ignored every
 * click that landed inside a menu, so it read as a menu that would not close.
 */
describe("ContextMenu", () => {
    it("opens only the innermost surface's menu for a right click", () => {
        const view = render(
            <MenuSurface label="outer">
                <MenuSurface label="inner" />
            </MenuSurface>,
        );

        fireEvent.contextMenu(view.getByTestId("inner"), { clientX: 10, clientY: 10 });

        expect(openMenus()).toBe(1);
        expect(document.querySelector('[data-context-menu="true"]')?.textContent).toBe("inner");
    });

    it("still answers a right click on the outer surface itself", () => {
        const view = render(
            <MenuSurface label="outer">
                <MenuSurface label="inner" />
            </MenuSurface>,
        );

        fireEvent.contextMenu(view.getByTestId("outer"), { clientX: 10, clientY: 10 });

        expect(openMenus()).toBe(1);
        expect(document.querySelector('[data-context-menu="true"]')?.textContent).toBe("outer");
    });

    it("closes whatever menu is open when another one opens", () => {
        const view = render(<TwoMenus />);
        expect(openMenus()).toBe(1);

        fireEvent.click(view.getByText("open second"));

        expect(openMenus()).toBe(1);
    });

    it("does not count a submenu as a second menu", () => {
        render(
            <ContextMenu
                items={[{ id: "parent", label: "Parent", submenu: [{ id: "child", label: "Child" }] }]}
                position={{ x: 1, y: 1 }}
                onClose={() => undefined}
            />,
        );

        fireEvent.mouseEnter(document.querySelector('[data-context-menu="true"] > div')!);

        expect(openMenus()).toBe(2);
    });

    it.each([
        ["the window losing focus", () => window.dispatchEvent(new Event("blur"))],
        ["the window being resized", () => window.dispatchEvent(new Event("resize"))],
        ["a wheel turned outside it", () => document.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true }))],
    ])("closes on %s", (_, happen) => {
        const onClose = vi.fn();
        render(<ContextMenu items={ITEMS} position={{ x: 1, y: 1 }} onClose={onClose} />);

        act(() => happen());

        expect(onClose).toHaveBeenCalled();
    });

    it("stays open for a wheel inside it, which scrolls the menu", () => {
        const onClose = vi.fn();
        render(<ContextMenu items={ITEMS} position={{ x: 1, y: 1 }} onClose={onClose} />);

        act(() => {
            document.querySelector('[data-context-menu="true"]')!.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
        });

        expect(onClose).not.toHaveBeenCalled();
    });

    it("marks the document while a menu is open, so the title bar stops being a drag region", () => {
        const onClose = vi.fn();
        const view = render(<ContextMenu items={ITEMS} position={{ x: 1, y: 1 }} onClose={onClose} />);
        expect(document.documentElement.hasAttribute("data-context-menu-open")).toBe(true);

        view.unmount();

        expect(document.documentElement.hasAttribute("data-context-menu-open")).toBe(false);
    });
});
