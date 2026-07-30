import { describe, expect, it } from "vitest";
import { shouldBakeCharacterAvatars } from "./useCharacterAvatarBake";

describe("shouldBakeCharacterAvatars", () => {
    it("bakes when the panel is open and the workspace is writable", () => {
        expect(shouldBakeCharacterAvatars(true, false)).toBe(true);
    });

    it("defers while frozen, so opening the panel writes nothing", () => {
        expect(shouldBakeCharacterAvatars(true, true)).toBe(false);
    });

    it("stays off when the panel has no character service yet", () => {
        expect(shouldBakeCharacterAvatars(false, false)).toBe(false);
        expect(shouldBakeCharacterAvatars(false, true)).toBe(false);
    });
});
