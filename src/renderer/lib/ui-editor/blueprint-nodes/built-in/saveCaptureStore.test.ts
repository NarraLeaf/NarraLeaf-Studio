import { describe, expect, it } from "vitest";
import {
    MAX_LIVE_SAVE_CAPTURES,
    isSaveCaptureLimitReached,
    readSaveCapture,
    storeSaveCapture,
} from "./saveCaptureStore";
import {
    normalizeBlueprintSaveSlot,
    toBlueprintSaveSlot,
    type BlueprintSaveSlot,
} from "@shared/types/blueprint/valueTypes";

describe("save slots", () => {
    it("reads a plain id as a stored slot, so wiring an id where a slot goes still works", () => {
        expect(normalizeBlueprintSaveSlot("01")).toEqual({ kind: "saveSlot", source: "stored", id: "01" });
        expect(normalizeBlueprintSaveSlot("  01  ")).toEqual({ kind: "saveSlot", source: "stored", id: "01" });
    });

    it("keeps the two sources apart, because they do not reach the same nodes", () => {
        const run = toBlueprintSaveSlot("run", "head#1");
        expect(normalizeBlueprintSaveSlot(run)).toEqual({ kind: "saveSlot", source: "run", id: "head#1" });
    });

    it("is nothing at all when there is no id, which is an unfinished node rather than a slot", () => {
        expect(toBlueprintSaveSlot("stored", "")).toBeNull();
        expect(toBlueprintSaveSlot("stored", "   ")).toBeNull();
        expect(normalizeBlueprintSaveSlot(undefined)).toBeNull();
        expect(normalizeBlueprintSaveSlot({ kind: "soundHandle", id: "x" })).toBeNull();
    });

    /** An unknown `source` is read as `stored`, which is the one that cannot be forged into reach. */
    it("does not let an unknown source become a captured run", () => {
        expect(normalizeBlueprintSaveSlot({ kind: "saveSlot", source: "elsewhere", id: "x" }))
            .toEqual({ kind: "saveSlot", source: "stored", id: "x" });
    });
});

describe("save captures", () => {
    it("hands back what it was given", () => {
        const locals: Record<string, unknown> = {};
        const run = { meta: { id: "a-run" } };
        const slot = storeSaveCapture(locals, "head", run);

        expect(slot.source).toBe("run");
        expect(readSaveCapture(locals, slot)).toBe(run);
    });

    /**
     * The lifetime rule, which is the whole reason a `run` slot does not reach a save screen: the
     * capture lives in one execution's locals, so another execution is simply not holding it.
     */
    it("is not readable from another execution", () => {
        const first: Record<string, unknown> = {};
        const second: Record<string, unknown> = {};
        const slot = storeSaveCapture(first, "head", { meta: {} });

        expect(readSaveCapture(second, slot)).toBeNull();
    });

    it("does not answer a stored slot with a capture", () => {
        const locals: Record<string, unknown> = {};
        storeSaveCapture(locals, "head", { meta: {} });

        expect(readSaveCapture(locals, toBlueprintSaveSlot("stored", "head#1") as BlueprintSaveSlot)).toBeNull();
    });

    it("gives each capture its own id, so two in one chain do not overwrite each other", () => {
        const locals: Record<string, unknown> = {};
        const first = storeSaveCapture(locals, "head", { meta: { id: "one" } });
        const second = storeSaveCapture(locals, "head", { meta: { id: "two" } });

        expect(first.id).not.toBe(second.id);
        expect(readSaveCapture(locals, first)).toEqual({ meta: { id: "one" } });
        expect(readSaveCapture(locals, second)).toEqual({ meta: { id: "two" } });
    });

    it("stops holding playthroughs past the cap", () => {
        const locals: Record<string, unknown> = {};
        expect(isSaveCaptureLimitReached(locals)).toBe(false);
        for (let index = 0; index < MAX_LIVE_SAVE_CAPTURES; index++) {
            storeSaveCapture(locals, "head", { meta: { index } });
        }
        expect(isSaveCaptureLimitReached(locals)).toBe(true);
    });
});
