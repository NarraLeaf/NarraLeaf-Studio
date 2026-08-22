import { describe, expect, it } from "vitest";
import { parseGameTestCommand, toGameTestEvent } from "./gameTestSignal";

describe("toGameTestEvent", () => {
    it("stamps the scope on a renderer error rather than letting the payload claim one", () => {
        expect(toGameTestEvent({ kind: "runtime-error", message: "boom", scope: "main" })).toEqual({
            kind: "runtime-error",
            scope: "renderer",
            message: "boom",
        });
    });

    it("widens an ending, keeping the id a test compares against", () => {
        expect(toGameTestEvent({ kind: "ending", endingId: "block-9", name: "Bad End" })).toEqual({
            kind: "ending",
            endingId: "block-9",
            name: "Bad End",
        });
    });

    it("accepts an ending nobody has named yet", () => {
        expect(toGameTestEvent({ kind: "ending", endingId: "block-9" })).toEqual({
            kind: "ending",
            endingId: "block-9",
            name: "",
        });
    });

    it("drops an ending with no id, which would match the empty string", () => {
        expect(toGameTestEvent({ kind: "ending", endingId: "", name: "Bad End" })).toBeNull();
        expect(toGameTestEvent({ kind: "ending", name: "Bad End" })).toBeNull();
    });

    it("widens a choice, keeping every option's own index", () => {
        expect(toGameTestEvent({
            kind: "choice",
            options: [
                { index: 0, text: "Go", disabled: false },
                { index: 2, text: "Stay", disabled: true },
            ],
        })).toEqual({
            kind: "choice",
            options: [
                { index: 0, text: "Go", disabled: false },
                { index: 2, text: "Stay", disabled: true },
            ],
        });
    });

    it("drops an option with no readable index rather than renumbering the rest", () => {
        expect(toGameTestEvent({
            kind: "choice",
            options: [{ text: "Go" }, { index: 1.5, text: "Wait" }, { index: 3 }],
        })).toEqual({
            kind: "choice",
            options: [{ index: 3, text: "", disabled: false }],
        });
    });

    it("refuses anything that is not a signal, an exit above all", () => {
        for (const signal of [null, 5, "game-end", {}, { kind: "exit" }, { kind: "console" }]) {
            expect(toGameTestEvent(signal)).toBeNull();
        }
    });
});

describe("parseGameTestCommand", () => {
    it("reads the three commands", () => {
        expect(parseGameTestCommand({ kind: "start", storyId: " s ", sceneId: "sc" }))
            .toEqual({ kind: "start", storyId: "s", sceneId: "sc" });
        expect(parseGameTestCommand({ kind: "advance" })).toEqual({ kind: "advance" });
        expect(parseGameTestCommand({ kind: "choose", index: 0 })).toEqual({ kind: "choose", index: 0 });
    });

    it("refuses a start with half a target", () => {
        expect(parseGameTestCommand({ kind: "start", storyId: "s" })).toBeNull();
        expect(parseGameTestCommand({ kind: "start", storyId: "  ", sceneId: "sc" })).toBeNull();
    });

    it("refuses an index that is not one", () => {
        for (const index of [-1, 1.5, "0", undefined]) {
            expect(parseGameTestCommand({ kind: "choose", index })).toBeNull();
        }
    });

    it("refuses a command this build does not know", () => {
        for (const command of [null, 5, {}, { kind: "teleport" }]) {
            expect(parseGameTestCommand(command)).toBeNull();
        }
    });
});
