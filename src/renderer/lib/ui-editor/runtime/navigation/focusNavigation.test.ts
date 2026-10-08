// @vitest-environment jsdom
/**
 * The focus a running game moves between its controls: which surface it moves on, which controls it
 * reaches, what an author's overrides do to it, and how the pointer and the keys share it.
 *
 * jsdom lays nothing out, so every control here is given its box through `data-box`.
 *
 * Comments in English per project convention.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_ROOT_ATTRIBUTE } from "../input/keyboardFocusHandover";
import {
    confirmNavigationFocus,
    enterNavigationScope,
    moveNavigationFocus,
    NAV_MODALITY_ATTRIBUTE,
    NAVIGATE_EVENT,
    notePointerOverGame,
    resolveNavigationScope,
    stepNavigationFocus,
} from "./focusNavigation";

function layOut(root: ParentNode): void {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-box]"))) {
        const [left, top, width, height] = element.dataset.box!.split(",").map(Number);
        element.getBoundingClientRect = () => ({
            left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
            toJSON: () => ({}),
        }) as DOMRect;
    }
}

function mount(html: string): { root: HTMLElement; by: (id: string) => HTMLElement } {
    document.body.innerHTML = `<div ${GAME_ROOT_ATTRIBUTE}>${html}</div>`;
    const root = document.querySelector<HTMLElement>(`[${GAME_ROOT_ATTRIBUTE}]`)!;
    layOut(root);
    return { root, by: id => document.getElementById(id) as HTMLElement };
}

const button = (id: string, box: string, extra = "") =>
    `<div data-ui-element-id="${id}-el" ${extra}><div id="${id}" role="button" tabindex="0" data-box="${box}"></div></div>`;

afterEach(() => {
    document.body.innerHTML = "";
});

describe("where navigation happens", () => {
    it("is the surface that owns the keys, and never a page under it", () => {
        const { root, by } = mount(`
            <div class="ui-editor-surface" id="page" tabindex="-1">${button("under", "0,0,100,40")}</div>
            <div class="ui-editor-surface" id="layer" data-ui-nav-scope="owner" tabindex="-1">
                ${button("yes", "0,100,100,40")}${button("no", "0,150,100,40")}
            </div>
        `);
        expect(resolveNavigationScope(root)).toBe(by("layer"));
        expect(moveNavigationFocus(root, "down")).toBe(true);
        expect(document.activeElement).toBe(by("yes"));
        expect(moveNavigationFocus(root, "down")).toBe(true);
        expect(document.activeElement).toBe(by("no"));
        // Nothing further down on the layer; the page under it is not reachable.
        expect(moveNavigationFocus(root, "down")).toBe(false);
        expect(document.activeElement).toBe(by("no"));
    });

    it("is the stage's choice menu when nothing owns the keys", () => {
        const { root, by } = mount(`
            <div class="ui-editor-surface" id="quick">${button("auto", "0,500,60,20")}</div>
            <div class="ui-editor-surface" id="choice" data-ui-nav-scope="stage">${button("first", "0,0,100,40")}</div>
        `);
        expect(resolveNavigationScope(root)).toBe(by("choice"));
        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("first"));
    });
});

describe("what it reaches", () => {
    it("steps over what an author took out, and lands on what an author put in", () => {
        const { root, by } = mount(`
            <div class="ui-editor-surface" data-ui-nav-scope="owner" tabindex="-1">
                ${button("a", "0,0,100,40")}
                <div data-ui-element-id="panel" data-ui-nav-focusable="never">${button("hidden", "0,50,100,40")}</div>
                <div id="picture" data-ui-element-id="picture" data-ui-nav-focusable="always" tabindex="0" data-box="0,100,100,40"></div>
            </div>
        `);
        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("a"));
        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("picture"));
    });

    it("follows an author's override when the move leaves the element", () => {
        const { root, by } = mount(`
            <div class="ui-editor-surface" data-ui-nav-scope="owner" tabindex="-1">
                ${button("top", "0,0,100,40", 'data-ui-nav-down="far-el"')}
                ${button("near", "0,50,100,40")}
                ${button("far", "300,300,100,40")}
            </div>
        `);
        moveNavigationFocus(root, "down");
        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("far"));
    });

    it("comes back into a remembering group where the player left it", () => {
        const { root, by } = mount(`
            <div class="ui-editor-surface" data-ui-nav-scope="owner" tabindex="-1">
                <div data-ui-element-id="tabs" data-ui-nav-region data-ui-nav-remember>
                    ${button("t0", "0,0,80,30")}${button("t1", "100,0,80,30")}${button("t2", "200,0,80,30")}
                </div>
                ${button("body", "0,100,280,200")}
            </div>
        `);
        moveNavigationFocus(root, "right");
        expect(document.activeElement).toBe(by("t0"));
        moveNavigationFocus(root, "right");
        moveNavigationFocus(root, "right");
        expect(document.activeElement).toBe(by("t2"));
        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("body"));
        moveNavigationFocus(root, "up");
        expect(document.activeElement).toBe(by("t2"));
    });

    it("steps like Tab through one stop per list, coming back round", () => {
        const { root, by } = mount(`
            <div class="ui-editor-surface" data-ui-nav-scope="owner" tabindex="-1">
                <div data-ui-element-id="list">
                    <div id="r0" data-ui-list-item-index="0" tabindex="0" data-box="0,0,100,30"></div>
                    <div id="r1" data-ui-list-item-index="1" tabindex="-1" data-box="0,30,100,30"></div>
                </div>
                ${button("back", "200,0,80,30")}
            </div>
        `);
        stepNavigationFocus(root, 1);
        expect(document.activeElement).toBe(by("r0"));
        stepNavigationFocus(root, 1);
        expect(document.activeElement).toBe(by("back"));
        stepNavigationFocus(root, 1);
        expect(document.activeElement).toBe(by("r0"));
        stepNavigationFocus(root, -1);
        expect(document.activeElement).toBe(by("back"));
    });
});

describe("the pointer and the keys", () => {
    it("starts the next move from the control the pointer rests on, and takes the keys' focus away", () => {
        const { root, by } = mount(`
            <div class="ui-editor-surface" id="page" data-ui-nav-scope="owner" tabindex="-1">
                ${button("a", "0,0,100,40")}${button("b", "0,50,100,40")}${button("c", "0,100,100,40")}
            </div>
        `);
        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("a"));
        expect(root.getAttribute(NAV_MODALITY_ATTRIBUTE)).toBe("keys");

        notePointerOverGame(root, { clientX: 10, clientY: 60, target: by("b"), pointerType: "mouse" });
        // One control looks selected: the focus went back to the page, and the ring with it.
        expect(document.activeElement).toBe(by("page"));
        expect(root.getAttribute(NAV_MODALITY_ATTRIBUTE)).toBe("pointer");
        // Resting on a control does not make Confirm press it.
        expect(confirmNavigationFocus(root)).toBe(false);

        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("c"));
    });

    it("ignores a pointer that has not moved", () => {
        const { root, by } = mount(`
            <div class="ui-editor-surface" data-ui-nav-scope="owner" tabindex="-1">
                ${button("a", "0,0,100,40")}${button("b", "0,50,100,40")}
            </div>
        `);
        notePointerOverGame(root, { clientX: 5, clientY: 5, target: by("a"), pointerType: "mouse" });
        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("b"));
        // The list scrolled under a still pointer: not a hover.
        notePointerOverGame(root, { clientX: 5, clientY: 5, target: by("a"), pointerType: "mouse" });
        expect(document.activeElement).toBe(by("b"));
    });

    it("lets the focused control keep a direction it has a use for", () => {
        const { root, by } = mount(`
            <div class="ui-editor-surface" data-ui-nav-scope="owner" tabindex="-1">
                <div data-ui-element-id="volume"><div id="volume" role="slider" tabindex="0" data-box="0,0,200,30"></div></div>
                ${button("back", "0,50,100,40")}
            </div>
        `);
        const nudged: string[] = [];
        by("volume").addEventListener(NAVIGATE_EVENT, event => {
            const { direction } = (event as CustomEvent<{ direction: string }>).detail;
            if (direction === "left" || direction === "right") {
                event.preventDefault();
                nudged.push(direction);
            }
        });
        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("volume"));
        expect(moveNavigationFocus(root, "right")).toBe(true);
        expect(document.activeElement).toBe(by("volume"));
        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("back"));
        expect(nudged).toEqual(["right"]);
    });

    it("presses the focused control the way Enter does", () => {
        const { root, by } = mount(`
            <div class="ui-editor-surface" data-ui-nav-scope="owner" tabindex="-1">${button("a", "0,0,100,40")}</div>
        `);
        const pressed = vi.fn();
        by("a").addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                pressed();
            }
        });
        const clicked = vi.fn();
        by("a").addEventListener("click", clicked);
        moveNavigationFocus(root, "down");
        expect(confirmNavigationFocus(root)).toBe(true);
        expect(pressed).toHaveBeenCalledTimes(1);
        expect(clicked).not.toHaveBeenCalled();
    });
});

describe("a scope opening", () => {
    it("focuses its entry control for a player on keys or a pad, and not for one pointing", () => {
        const { by } = mount(`
            <div class="ui-editor-surface" id="page" data-ui-nav-scope="owner" tabindex="-1">
                ${button("a", "0,0,100,40")}${button("b", "0,50,100,40", "data-ui-nav-preferred")}
            </div>
        `);
        by("page").focus();
        expect(enterNavigationScope(by("page"), "pointer")).toBe("skipped");
        expect(document.activeElement).toBe(by("page"));
        expect(enterNavigationScope(by("page"), "gamepad")).toBe("focused");
        expect(document.activeElement).toBe(by("b"));
    });

    it("lands where the player left a page they come back to, though the page was drawn again", () => {
        const page = (id: string) => `
            <div class="ui-editor-surface" id="${id}" data-ui-surface-id="title" data-ui-nav-scope="owner" tabindex="-1">
                ${button("start", "0,0,100,40")}${button("config", "0,50,100,40")}
            </div>`;
        const { root, by } = mount(page("first"));
        moveNavigationFocus(root, "down");
        moveNavigationFocus(root, "down");
        expect(document.activeElement).toBe(by("config"));
        root.innerHTML = page("again");
        layOut(root);
        expect(enterNavigationScope(by("again"), "gamepad")).toBe("focused");
        expect(document.activeElement).toBe(by("config"));
    });

    it("lands on the element the surface names, and never when told not to", () => {
        const { by } = mount(`
            <div class="ui-editor-surface" id="page" data-ui-nav-scope="owner" tabindex="-1" data-ui-nav-default="b-el">
                ${button("a", "0,0,100,40")}${button("b", "0,50,100,40")}
            </div>
            <div class="ui-editor-surface" id="quiet" data-ui-nav-scope="stage" data-ui-nav-autofocus="never">${button("c", "0,200,100,40")}</div>
        `);
        expect(enterNavigationScope(by("page"), "key")).toBe("focused");
        expect(document.activeElement).toBe(by("b"));
        expect(enterNavigationScope(by("quiet"), "key")).toBe("skipped");
    });
});
