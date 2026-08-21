// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MnemonicLabel, TitleBarMenus, useMnemonicReveal, useTitleBarMenu } from "./titleBarMenus";

/**
 * What makes a row of menus read as a menu bar rather than as three independent popups.
 *
 * Every rule here has a way of regressing that looks like nothing on screen until an author hits it:
 * menus stacking up because each kept its own boolean, the pointer or an arrow walking onto a control
 * that was never a menu, an Escape swallowed by whichever editor holds focus behind the menu, and an
 * accelerator quietly taking a key off a binding an author had rebound on purpose.
 */

function Menu({ id, label, hotTrack = false, mnemonic, innerMnemonics, onInnerMnemonic, onKeyDown }: {
    id: string;
    label: string;
    hotTrack?: boolean;
    mnemonic?: string;
    innerMnemonics?: readonly string[];
    onInnerMnemonic?: (mnemonic: string) => void;
    onKeyDown?: (event: KeyboardEvent) => boolean;
}) {
    const menu = useTitleBarMenu(id, { hotTrack, mnemonic, innerMnemonics, onInnerMnemonic, onKeyDown });
    const reveal = useMnemonicReveal();
    return (
        <div ref={menu.ref}>
            <button onClick={menu.toggle} {...menu.triggerProps}>
                <MnemonicLabel label={label} mnemonic={mnemonic} reveal={reveal} />
            </button>
            {menu.open && <div role="menu" aria-label={`${label} menu`} />}
        </div>
    );
}

/** Two action groups and a control that merely carries a menu. */
function renderBar(options: { suspended?: boolean; onKeyDown?: (event: KeyboardEvent) => boolean } = {}) {
    render(
        <TitleBarMenus suspended={options.suspended}>
            <Menu id="file" label="File" hotTrack mnemonic="F" onKeyDown={options.onKeyDown} />
            <Menu id="edit" label="Edit" hotTrack mnemonic="E" />
            <Menu id="help" label="帮助" hotTrack mnemonic="H" />
            <Menu id="switcher" label="Project" />
        </TitleBarMenus>,
    );
}

/** Whatever is on screen, by name. */
function onScreen(): (string | null)[] {
    return screen.queryAllByRole("menu").map(menu => menu.getAttribute("aria-label"));
}

function trigger(name: string): HTMLElement {
    return screen.getByRole("button", { name });
}

/** React derives `pointerenter` from `pointerover`; dispatching the enter itself reaches nothing. */
function slideOnto(name: string): void {
    fireEvent.pointerOver(trigger(name));
}

function press(key: string, init: KeyboardEventInit = {}): boolean {
    return fireEvent.keyDown(document.body, { key, ...init });
}

/**
 * An accelerator lands one task later, once every other listener has had the key.
 *
 * Inside `act` because waiting out that task is only half of it: the handler calls `setOpen` from
 * a timer, so React still has to render before anything is on screen. Awaiting the timer alone
 * leaves that render racing the assertion after it - green on an idle machine, and not on a busy
 * one, which is where it was caught.
 */
async function pressAccelerator(key: string, init: KeyboardEventInit = {}): Promise<void> {
    await act(async () => {
        press(key, { altKey: true, code: `Key${key.toUpperCase()}`, cancelable: true, ...init });
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

afterEach(cleanup);

describe("the title bar's menus", () => {
    it("puts away the open menu when another one is clicked", () => {
        renderBar();

        fireEvent.click(trigger("File"));
        expect(onScreen()).toEqual(["File menu"]);

        fireEvent.click(trigger("Edit"));
        expect(onScreen()).toEqual(["Edit menu"]);
    });

    it("hands the pointer from one action group to the next, with no second click", () => {
        renderBar();
        fireEvent.click(trigger("File"));

        slideOnto("Edit");

        expect(onScreen()).toEqual(["Edit menu"]);
    });

    it("stays shut for a pointer crossing a bar that has nothing open", () => {
        renderBar();

        slideOnto("Edit");

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

describe("the keyboard", () => {
    it("closes the open menu on Escape, wherever the focus happens to be", () => {
        renderBar();
        fireEvent.click(trigger("Project"));

        press("Escape");

        expect(onScreen()).toEqual([]);
    });

    it("keeps Escape away from whatever is behind the menu", () => {
        renderBar();
        fireEvent.click(trigger("File"));

        // A false return means the listener never saw it: the bar consumed the key.
        expect(press("Escape")).toBe(false);
    });

    it("gives the open menu first refusal, and acts on what it declines", () => {
        const consumed: string[] = [];
        // Stands for a submenu that is open once and closed after the first Escape.
        let submenuOpen = true;
        renderBar({
            onKeyDown: event => {
                consumed.push(event.key);
                if (event.key !== "Escape" || !submenuOpen) return false;
                submenuOpen = false;
                return true;
            },
        });
        fireEvent.click(trigger("File"));

        press("Escape");
        expect(consumed).toEqual(["Escape"]);
        // The menu said it had handled it - one submenu level closing - so the bar left it open.
        expect(onScreen()).toEqual(["File menu"]);

        press("Escape");
        expect(onScreen()).toEqual([]);
    });

    it("walks the action groups with the arrow keys, and wraps", () => {
        renderBar();
        fireEvent.click(trigger("File"));

        press("ArrowRight");
        expect(onScreen()).toEqual(["Edit menu"]);

        press("ArrowLeft");
        expect(onScreen()).toEqual(["File menu"]);

        press("ArrowLeft");
        expect(onScreen()).toEqual(["帮助 menu"]);
    });

    it("does not walk out of a control that merely carries a menu", () => {
        renderBar();
        fireEvent.click(trigger("Project"));

        // Nothing moves, and the key is left for the popup's own content.
        expect(press("ArrowRight")).toBe(true);
        expect(onScreen()).toEqual(["Project menu"]);
    });

    it("opens a menu by its accelerator", async () => {
        renderBar();

        await pressAccelerator("h");

        expect(onScreen()).toEqual(["帮助 menu"]);
    });

    it("switches menus by accelerator while one is already open", async () => {
        renderBar();
        fireEvent.click(trigger("File"));

        await pressAccelerator("e");

        expect(onScreen()).toEqual(["Edit menu"]);
    });

    it("yields the key to a binding that has already claimed it, whichever listened first", async () => {
        // Alt+H aligns in the UI editor. `KeybindingService` marks what it handled on the same
        // event; an accelerator is the weaker claim and must not fire a second thing. Claimed here
        // from a listener registered AFTER the bar's, which is the order that used to slip through.
        renderBar();
        const claim = (event: Event) => event.preventDefault();
        window.addEventListener("keydown", claim);

        await pressAccelerator("h");
        window.removeEventListener("keydown", claim);

        expect(onScreen()).toEqual([]);
    });

    it("ignores an accelerator carrying a second modifier", async () => {
        renderBar();

        await pressAccelerator("e", { ctrlKey: true });

        expect(onScreen()).toEqual([]);
    });

    it("reaches a menu that has been collapsed into another one, by the letter it always had", async () => {
        // The hamburger arrangement: File is a row inside one button rather than a button of its
        // own. Alt+F is the same key it has always been, and it has to arrive somewhere.
        const reached: string[] = [];
        render(
            <TitleBarMenus>
                <Menu
                    id="main"
                    label="Menu"
                    hotTrack
                    innerMnemonics={["F", "E", "H"]}
                    onInnerMnemonic={letter => reached.push(letter)}
                />
            </TitleBarMenus>,
        );

        await pressAccelerator("f");

        expect(onScreen()).toEqual(["Menu menu"]);
        // Which row to open on, told to the menu before it appeared rather than after.
        expect(reached).toEqual(["F"]);
    });

    it("keeps reporting the letter when that menu is already the open one", async () => {
        // Alt+E after Alt+F. Nothing the bar holds changes - same member, still open - so the letter
        // is all the menu has to go on, and it has to arrive every time or the second accelerator
        // silently leaves the first one's menu on screen.
        const reached: string[] = [];
        render(
            <TitleBarMenus>
                <Menu
                    id="main"
                    label="Menu"
                    hotTrack
                    innerMnemonics={["F", "E"]}
                    onInnerMnemonic={letter => reached.push(letter)}
                />
            </TitleBarMenus>,
        );

        await pressAccelerator("f");
        await pressAccelerator("e");

        expect(onScreen()).toEqual(["Menu menu"]);
        expect(reached).toEqual(["F", "E"]);
    });

    it("leaves the letter to a menu that is still a menu of its own", async () => {
        // Both arrangements can declare F. A menu on the bar owns the letter it names itself by, so
        // a collapsed one holding the same letter must not take it - which is what would happen if
        // the two were matched in one pass and the hamburger happened to register first.
        const reached: string[] = [];
        render(
            <TitleBarMenus>
                <Menu
                    id="main"
                    label="Menu"
                    hotTrack
                    innerMnemonics={["F"]}
                    onInnerMnemonic={letter => reached.push(letter)}
                />
                <Menu id="file" label="File" hotTrack mnemonic="F" />
            </TitleBarMenus>,
        );

        await pressAccelerator("f");

        expect(onScreen()).toEqual(["File menu"]);
        expect(reached).toEqual([]);
    });

    it("shows what Alt reaches only while Alt is down", () => {
        renderBar();
        expect(trigger("File").innerHTML).not.toContain("<u>");

        press("Alt", { altKey: true });
        expect(trigger("File").innerHTML).toContain("<u>F</u>");

        fireEvent.keyUp(document.body, { key: "Alt", altKey: false });
        expect(trigger("File").innerHTML).not.toContain("<u>");
    });

    it("stands down while a dialog is up", async () => {
        renderBar({ suspended: true });

        await pressAccelerator("f");
        expect(onScreen()).toEqual([]);

        fireEvent.click(trigger("File"));
        expect(press("Escape")).toBe(true);
        expect(onScreen()).toEqual(["File menu"]);
    });
});

describe("a menu's accelerator on its label", () => {
    const html = (label: string, mnemonic: string, reveal: boolean) => {
        const { container } = render(<MnemonicLabel label={label} mnemonic={mnemonic} reveal={reveal} />);
        return container.innerHTML;
    };

    it("underlines the letter the label already carries", () => {
        expect(html("File", "F", true)).toBe("<u>F</u>ile");
    });

    it("appends the letter to a label that cannot carry it", () => {
        // What every menu bar on the platform does once the labels stop being English.
        expect(html("文件", "F", false)).toContain("(F)");
        expect(html("文件", "F", true)).toContain("<u>F</u>");
    });

    it("leaves a menu with no accelerator alone", () => {
        const { container } = render(<MnemonicLabel label="Plugins" reveal />);
        expect(container.innerHTML).toBe("Plugins");
    });
});

describe("the bar and React's own strictness", () => {
    it("survives a member unmounting while its menu is open", () => {
        function Bar({ withEdit }: { withEdit: boolean }) {
            return (
                <TitleBarMenus>
                    <Menu id="file" label="File" hotTrack mnemonic="F" />
                    {withEdit && <Menu id="edit" label="Edit" hotTrack mnemonic="E" />}
                </TitleBarMenus>
            );
        }
        const view = render(<Bar withEdit />);
        fireEvent.click(trigger("Edit"));
        expect(onScreen()).toEqual(["Edit menu"]);

        view.rerender(<Bar withEdit={false} />);
        expect(onScreen()).toEqual([]);

        // The bar must not still believe something is open: a hover would otherwise chain off it.
        slideOnto("File");
        expect(onScreen()).toEqual([]);
    });
});
