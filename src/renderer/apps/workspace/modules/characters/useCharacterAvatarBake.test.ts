import { describe, expect, it } from "vitest";
import { resolveAvatarBakePortrait, shouldBakeCharacterAvatars } from "./useCharacterAvatarBake";

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

describe("resolveAvatarBakePortrait", () => {
    const entry = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
    const pose = { x: 0.2, y: 0.2, w: 0.2, h: 0.1 };
    const profile = { x: 0.3, y: 0.3, w: 0.2, h: 0.1 };

    it("prefers the differential's own crop over everything", () => {
        // The only framing a layered character can carry per tag combination — if anything above it
        // won, reframing one look would be silently overruled by the character-wide crop.
        expect(resolveAvatarBakePortrait({ entry, pose, profile })).toBe(entry);
    });

    it("falls back to the pose crop, which predates the entry crop and story rows still read", () => {
        expect(resolveAvatarBakePortrait({ pose, profile })).toBe(pose);
    });

    it("falls back to the character-wide crop last", () => {
        expect(resolveAvatarBakePortrait({ profile })).toBe(profile);
    });

    it("reports nothing rather than a guess, so the head detector runs", () => {
        expect(resolveAvatarBakePortrait({})).toBeUndefined();
        // `getAvatarPortrait` answers `null`, not `undefined`; a nullish chain that stopped at the
        // first `null` would pin every differential to the automatic crop.
        expect(resolveAvatarBakePortrait({ entry: null, pose: null, profile })).toBe(profile);
    });
});
