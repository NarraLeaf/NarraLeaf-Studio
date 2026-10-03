// @vitest-environment jsdom
/**
 * The entry that owns the keyboard holds the focus: a page opened by keyboard is where the next Tab
 * starts, a focus outside the game is left alone, and a layer closing gives the focus back to the
 * control that opened it.
 *
 * Comments in English per project convention.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GAME_ROOT_ATTRIBUTE, releaseKeyboardFocus, takeKeyboardFocus } from "./keyboardFocusHandover";

afterEach(() => {
    document.body.innerHTML = "";
});

/** A window with its own chrome beside a game: a stage control, a page, a modal layer. */
function mountGame() {
    document.body.innerHTML = `
        <button id="chrome">Minimise</button>
        <div ${GAME_ROOT_ATTRIBUTE}>
            <div class="ui-editor-surface" id="stage"><div id="save" role="button" tabindex="0">Save</div></div>
            <div class="ui-editor-surface" id="page" tabindex="-1"><div id="back" role="button" tabindex="0">Back</div></div>
            <div class="ui-editor-surface" id="layer" tabindex="-1"><div id="yes" role="button" tabindex="0">Yes</div></div>
        </div>
    `;
    const by = (id: string) => document.getElementById(id) as HTMLElement;
    return { chrome: by("chrome"), stage: by("stage"), save: by("save"), page: by("page"), back: by("back"), layer: by("layer"), yes: by("yes") };
}

describe("a page that starts owning the keyboard", () => {
    it("takes the focus from nobody", () => {
        const { page } = mountGame();

        expect(takeKeyboardFocus(page, null)).toBe("held");
        expect(document.activeElement).toBe(page);
    });

    it("takes it from the stage control the player opened it with", () => {
        const { page, save } = mountGame();
        save.focus();

        expect(takeKeyboardFocus(page, null)).toBe("held");
        expect(document.activeElement).toBe(page);
    });

    it("takes it from a control that can no longer be used", () => {
        const { page, stage, save } = mountGame();
        save.focus();
        stage.setAttribute("inert", "");

        takeKeyboardFocus(page, null);
        expect(document.activeElement).toBe(page);
    });

    it("leaves it where it is when it is already inside", () => {
        const { page, back } = mountGame();
        back.focus();

        expect(takeKeyboardFocus(page, null)).toBe("held");
        expect(document.activeElement).toBe(back);
    });

    it("leaves a focus that is not the game's: the window's own buttons, a panel beside the game", () => {
        const { page, chrome } = mountGame();
        chrome.focus();

        expect(takeKeyboardFocus(page, null)).toBe("elsewhere");
        expect(document.activeElement).toBe(chrome);
    });
});

describe("a layer over a page", () => {
    it("gives the focus back to the control that opened it when it closes", () => {
        const { page, back, layer, yes } = mountGame();
        back.focus();

        // The layer takes the keys: the page lets go, remembering Back; the layer takes the focus.
        const remembered = releaseKeyboardFocus(page);
        expect(remembered).toBe(back);
        takeKeyboardFocus(layer, null);
        yes.focus();

        // The layer closes: it lets go, and the page takes the focus back where it was.
        expect(releaseKeyboardFocus(layer)).toBe(yes);
        expect(takeKeyboardFocus(page, remembered)).toBe("held");
        expect(document.activeElement).toBe(back);
    });

    it("hands the focus to the page itself when the control it remembers has gone", () => {
        const { page, back } = mountGame();
        back.focus();
        const remembered = releaseKeyboardFocus(page);
        back.remove();

        takeKeyboardFocus(page, remembered);
        expect(document.activeElement).toBe(page);
    });
});

describe("letting go", () => {
    it("only lets go of a focus inside the surface", () => {
        const { page, save } = mountGame();
        save.focus();

        expect(releaseKeyboardFocus(page)).toBeNull();
        expect(document.activeElement).toBe(save);
    });

    it("remembers nothing when the surface itself had it", () => {
        const { page } = mountGame();
        page.focus();

        expect(releaseKeyboardFocus(page)).toBeNull();
        expect(document.activeElement).toBe(document.body);
    });
});
