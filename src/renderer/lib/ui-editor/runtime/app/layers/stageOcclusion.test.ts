/**
 * The shipped defect this locks down: skipping turned on from the quick menu, Config opened
 * mid-skip, and the story ran to its end behind the settings screen - the gate the skip loop asks
 * before every step was "is a session mounted with its stage on screen", which a page drawn over the
 * stage does not change.
 */
import { describe, expect, it } from "vitest";
import { isPageEntryDrawn, isStageCovered } from "./stageOcclusion";

/** The page lane after a game took the screen: everything that was open is hidden. */
function runningGame(entryKeys: readonly string[]) {
    return {
        pageEntries: entryKeys.map(key => ({ key })),
        pagesHiddenForGame: true,
        gameHiddenKeys: new Set(entryKeys),
        layers: [] as { modal: boolean }[],
    };
}

/** What `openSurface` does while a game runs: a new entry, and the game hid none of it. */
function openOverGame(state: ReturnType<typeof runningGame>, key: string) {
    return { ...state, pageEntries: [...state.pageEntries, { key }] };
}

describe("isPageEntryDrawn", () => {
    it("draws every entry while no game has taken the screen", () => {
        const drawn = isPageEntryDrawn({
            entryKey: "title:1",
            pagesHiddenForGame: false,
            gameHiddenKeys: new Set(["title:1"]),
        });
        expect(drawn).toBe(true);
    });

    it("stops drawing the entries a running game hid", () => {
        expect(isPageEntryDrawn({
            entryKey: "title:1",
            pagesHiddenForGame: true,
            gameHiddenKeys: new Set(["title:1"]),
        })).toBe(false);
        expect(isPageEntryDrawn({
            entryKey: "config:2",
            pagesHiddenForGame: true,
            gameHiddenKeys: new Set(["title:1"]),
        })).toBe(true);
    });
});

describe("isStageCovered", () => {
    it("says nothing covers a stage that is not there", () => {
        // The title screen, before anything started. The pages on the stack are the app itself.
        expect(isStageCovered({
            pageEntries: [{ key: "title:1" }],
            pagesHiddenForGame: false,
            gameHiddenKeys: new Set(),
            layers: [],
        })).toBe(false);
    });

    it("leaves a running game uncovered while only the stage is on screen", () => {
        expect(isStageCovered(runningGame(["title:1"]))).toBe(false);
    });

    it("reports the settings screen the player opened mid-game", () => {
        expect(isStageCovered(openOverGame(runningGame(["title:1"]), "config:2"))).toBe(true);
    });

    it("uncovers the stage again when that screen is closed", () => {
        const opened = openOverGame(runningGame(["title:1"]), "config:2");
        const closed = { ...opened, pageEntries: opened.pageEntries.slice(0, 1) };
        expect(isStageCovered(closed)).toBe(false);
    });

    // The reason this asks the hidden set rather than the `gameOverlay` presentation stamp: quitting
    // from a settings screen leaves that entry on the stack, and the next playthrough hides it along
    // with everything else. Reading the stamp would report a covered stage for that entire run.
    it("does not count a settings screen left over from the previous playthrough", () => {
        const stack = ["title:1", "config:2", "ending:3"];
        expect(isStageCovered(runningGame(stack))).toBe(false);
        expect(isStageCovered(openOverGame(runningGame(stack), "config:4"))).toBe(true);
    });

    it("counts a modal layer, which makes everything below it inert", () => {
        const state = runningGame(["title:1"]);
        expect(isStageCovered({ ...state, layers: [{ modal: true }] })).toBe(true);
    });

    it("ignores a layer that never asked for the screen", () => {
        // A toast or a HUD over a running story. The stage stays exactly as live as it was, and a
        // skip that stopped for one would stop for a notification the story itself raised.
        const state = runningGame(["title:1"]);
        expect(isStageCovered({ ...state, layers: [{ modal: false }] })).toBe(false);
    });
});
