import { describe, expect, it } from "vitest";
import type { CharacterAppearanceSummary } from "@shared/types/devMode";
import {
    characterAvatarAssetId,
    characterAvatarKey,
    characterAvatarKeyFromTags,
    characterAvatarKeys,
    parseCharacterAvatarAssetId,
    resolveCharacterAvatarAssetId,
} from "./characterAvatar";

const preset: CharacterAppearanceSummary = {
    kind: "preset",
    poses: [
        { id: "p1", name: "Neutral", assetId: "asset-neutral" },
        { id: "p2", name: "Angry", assetId: "asset-angry" },
    ],
    defaultPoseId: "p1",
};

const layered: CharacterAppearanceSummary = {
    kind: "layered",
    canvas: { width: 1000, height: 2000 },
    axes: [
        { id: "mood", name: "Mood", tags: [{ id: "happy", name: "Happy" }, { id: "sad", name: "Sad" }], defaultTagId: "happy" },
        { id: "outfit", name: "Outfit", tags: [{ id: "coat", name: "Coat" }, { id: "shirt", name: "Shirt" }], defaultTagId: "shirt" },
    ],
    layers: [
        { id: "l1", name: "Body", axisId: null, assetId: "asset-body" },
        { id: "l2", name: "Face", axisId: "mood", options: { happy: "asset-happy", sad: "asset-sad" } },
    ],
};

describe("characterAvatarKey", () => {
    it("keys a preset differential on its pose, falling back to the default pose", () => {
        expect(characterAvatarKey(preset, { poseId: "p2" })).toBe("p2");
        expect(characterAvatarKey(preset, {})).toBe("p1");
    });

    it("refuses a pose the character does not have", () => {
        expect(characterAvatarKey(preset, { poseId: "ghost" })).toBeNull();
    });

    it("sorts tag ids so two rows striking the same pose hit one bake", () => {
        const written = characterAvatarKey(layered, { tags: { outfit: "coat", mood: "sad" } });
        const otherOrder = characterAvatarKey(layered, { tags: { mood: "sad", outfit: "coat" } });
        expect(written).toBe(otherOrder);
        expect(written).toBe("coat+sad");
    });

    it("fills a partial selection out to every avatar axis", () => {
        // `/face sad` names only the mood; the outfit stays at its default, exactly as on stage.
        expect(characterAvatarKey(layered, { tags: { mood: "sad" } })).toBe("sad+shirt");
    });

    it("keys only on the declared avatar axes", () => {
        const moodOnly = { ...layered, avatarAxisIds: ["mood"] } as CharacterAppearanceSummary;
        expect(characterAvatarKey(moodOnly, { tags: { mood: "sad", outfit: "coat" } })).toBe("sad");
    });
});

describe("characterAvatarKeyFromTags", () => {
    it("reads the engine's flat tag array back into a key", () => {
        expect(characterAvatarKeyFromTags(layered, ["sad", "coat"])).toBe("coat+sad");
    });

    it("agrees with the key the baker enumerated", () => {
        expect(characterAvatarKeys(layered)).toContain(characterAvatarKeyFromTags(layered, ["sad", "coat"]));
    });

    it("drops tags the appearance no longer knows rather than minting an unbaked key", () => {
        // A stale tag would otherwise produce "coat+ghost", which nothing was ever baked for.
        expect(characterAvatarKeyFromTags(layered, ["ghost", "coat"])).toBe("coat+happy");
    });

    it("is null for a preset character, whose current differential arrives as a src not as tags", () => {
        expect(characterAvatarKeyFromTags(preset, ["p1"])).toBeNull();
    });
});

describe("characterAvatarKeys", () => {
    it("enumerates one key per pose", () => {
        expect(characterAvatarKeys(preset)).toEqual(["p1", "p2"]);
    });

    it("enumerates the cartesian product of the avatar axes", () => {
        expect(characterAvatarKeys(layered).sort()).toEqual(["coat+happy", "coat+sad", "happy+shirt", "sad+shirt"]);
    });

    it("shrinks with the declared avatar axes", () => {
        const moodOnly = { ...layered, avatarAxisIds: ["mood"] } as CharacterAppearanceSummary;
        expect(characterAvatarKeys(moodOnly).sort()).toEqual(["happy", "sad"]);
    });
});

describe("characterAvatarAssetId", () => {
    it("round-trips ids that contain the separator", () => {
        const id = characterAvatarAssetId("char:with:colons", "coat+sad");
        expect(parseCharacterAvatarAssetId(id)).toEqual({ characterId: "char:with:colons", key: "coat+sad" });
    });

    it("does not claim ordinary asset ids", () => {
        expect(parseCharacterAvatarAssetId("4b645b59-1723-4ac9-98ab-e6859b837bef")).toBeNull();
    });
});

describe("resolveCharacterAvatarAssetId", () => {
    const character = { id: "alice", appearance: preset, defaultAvatarAssetId: "asset-default" };

    it("prefers the author's override over the bake", () => {
        const withBoth = {
            ...character,
            appearance: { ...preset, avatars: { p2: { baked: true, overrideAssetId: "asset-hand-drawn" } } } as CharacterAppearanceSummary,
        };
        expect(resolveCharacterAvatarAssetId(withBoth, "p2")).toBe("asset-hand-drawn");
    });

    it("addresses the bake by its synthetic id", () => {
        const withBake = {
            ...character,
            appearance: { ...preset, avatars: { p2: { baked: true } } } as CharacterAppearanceSummary,
        };
        expect(resolveCharacterAvatarAssetId(withBake, "p2")).toBe(characterAvatarAssetId("alice", "p2"));
    });

    it("falls back to the character default when the differential has nothing", () => {
        expect(resolveCharacterAvatarAssetId(character, "p2")).toBe("asset-default");
        // No differential at all - the character is speaking from off-stage.
        expect(resolveCharacterAvatarAssetId(character, null)).toBe("asset-default");
    });

    it("answers null rather than substituting the sprite", () => {
        expect(resolveCharacterAvatarAssetId({ id: "bob", appearance: preset }, "p1")).toBeNull();
    });
});
