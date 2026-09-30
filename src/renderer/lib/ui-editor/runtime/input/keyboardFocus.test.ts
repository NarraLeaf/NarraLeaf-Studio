// @vitest-environment jsdom
/**
 * Who a key belongs to when a control has the keyboard focus, and how a control comes to have it.
 *
 * `keyInputClaimedByControl`: a focused control takes its activation keys, so a key it acts on
 * raises no input action - Enter on a focused Save button saves and does not also advance the story.
 * `keepPointerPressOffKeyboardFocus`: only the keyboard puts the focus on a game's controls, so a
 * click on the quick menu's Auto does not leave the next Space with Auto.
 *
 * Comments in English per project convention.
 */
import { afterEach, describe, expect, it } from "vitest";
import { keepPointerPressOffKeyboardFocus } from "./pointerKeyboardFocus";
import { keyInputClaimedByControl } from "./surfaceInputActions";

afterEach(() => {
    document.body.innerHTML = "";
});

function keyAt(target: EventTarget, key: string, prevent = false) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    if (prevent) {
        event.preventDefault();
    }
    return event;
}

function mount(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
}

describe("a key the focused control speaks for", () => {
    it("is the control's when the control acted on it and said so, whatever the key", () => {
        const row = mount(`<div data-ui-list-item-index="0" tabindex="0"></div>`).firstElementChild!;

        expect(keyInputClaimedByControl(keyAt(row, "ArrowDown", true))).toBe(true);
        expect(keyInputClaimedByControl(keyAt(document.body, "Escape", true))).toBe(true);
    });

    it("is the control's when it is Enter or Space on a control that presses on them", () => {
        const host = mount(`
            <button id="native"></button>
            <div id="drawn" role="button" tabindex="0"><span id="label">Save</span></div>
            <div id="switch" role="switch" tabindex="0"></div>
            <input id="box" type="checkbox" />
            <div id="row" data-ui-list-item-index="1" tabindex="-1"></div>
        `);
        for (const id of ["native", "drawn", "label", "switch", "box", "row"]) {
            const target = host.querySelector(`#${id}`)!;
            expect(keyInputClaimedByControl(keyAt(target, "Enter")), id).toBe(true);
            expect(keyInputClaimedByControl(keyAt(target, " ")), id).toBe(true);
        }
    });

    it("stays the game's when it is any other key, so a focused button does not stop Escape closing a page", () => {
        const button = mount(`<div role="button" tabindex="0"></div>`).firstElementChild!;

        for (const key of ["Escape", "ArrowDown", "a", "Control"]) {
            expect(keyInputClaimedByControl(keyAt(button, key)), key).toBe(false);
        }
    });

    it("stays the game's when nothing that presses has the focus: the page, the player, a plain box", () => {
        const host = mount(`<div id="player" tabindex="0"><div id="plain"></div></div>`);

        expect(keyInputClaimedByControl(keyAt(document.body, " "))).toBe(false);
        expect(keyInputClaimedByControl(keyAt(window, "Enter"))).toBe(false);
        expect(keyInputClaimedByControl(keyAt(host.querySelector("#player")!, " "))).toBe(false);
        expect(keyInputClaimedByControl(keyAt(host.querySelector("#plain")!, "Enter"))).toBe(false);
    });
});

function mouseDownOn(target: Element) {
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    keepPointerPressOffKeyboardFocus(event);
    return event;
}

describe("a pointer press on a game control", () => {
    const surface = (inner: string) => mount(`<div class="ui-editor-surface">${inner}</div>`);

    it("does not focus the button, the switch or the list row it lands on", () => {
        const host = surface(`
            <div id="button" role="button" tabindex="0"><span id="label">Auto</span></div>
            <div id="switch" role="switch" tabindex="0"></div>
            <div id="row" data-ui-list-item-index="0" tabindex="0"><div id="cell"></div></div>
        `);
        for (const id of ["button", "label", "switch", "row", "cell"]) {
            expect(mouseDownOn(host.querySelector(`#${id}`)!).defaultPrevented, id).toBe(true);
        }
    });

    it("takes the focus off whatever had it, a control reached with Tab included", () => {
        const host = surface(`
            <div id="save" role="button" tabindex="0"></div>
            <div id="auto" role="button" tabindex="0"></div>
        `);
        const save = host.querySelector<HTMLElement>("#save")!;
        save.focus();
        expect(document.activeElement).toBe(save);

        mouseDownOn(host.querySelector("#auto")!);

        expect(document.activeElement).toBe(document.body);
    });

    it("leaves the focus to a field or anything else inside a row that takes it for its own sake", () => {
        const host = surface(`
            <div data-ui-list-item-index="0" tabindex="0">
                <input id="field" type="text" />
                <div id="inner" role="button" tabindex="0"></div>
            </div>
            <div id="plain"></div>
        `);
        expect(mouseDownOn(host.querySelector("#field")!).defaultPrevented).toBe(false);
        // A button in a row is a control of its own, and is answered as one.
        expect(mouseDownOn(host.querySelector("#inner")!).defaultPrevented).toBe(true);
        expect(mouseDownOn(host.querySelector("#plain")!).defaultPrevented).toBe(false);
    });

    it("leaves everything outside a game's surfaces alone", () => {
        const button = mount(`<div role="button" tabindex="0"></div>`).firstElementChild!;

        expect(mouseDownOn(button).defaultPrevented).toBe(false);
    });
});
