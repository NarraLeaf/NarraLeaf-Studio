import { beforeEach, describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import {
    avatarBakeInputs,
    bakeStaleAvatarsBeforeLaunch,
    resetAvatarBakeStateForTests,
    resolveAvatarBakePortrait,
    shouldBakeCharacterAvatars,
} from "./useCharacterAvatarBake";

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

    it("falls back to the character-wide crop", () => {
        expect(resolveAvatarBakePortrait({ profile })).toBe(profile);
    });

    it("takes a same-size pose's framing only where the author framed nothing for this one", () => {
        const inherited = { x: 0.4, y: 0.4, w: 0.2, h: 0.1 };
        expect(resolveAvatarBakePortrait({ inherited })).toBe(inherited);
        expect(resolveAvatarBakePortrait({ profile, inherited })).toBe(profile);
        expect(resolveAvatarBakePortrait({ pose, inherited })).toBe(pose);
    });

    it("reports nothing rather than a guess, so the head detector runs", () => {
        expect(resolveAvatarBakePortrait({})).toBeUndefined();
        // `getAvatarPortrait` answers `null`, not `undefined`; a nullish chain that stopped at the
        // first `null` would pin every differential to the automatic crop.
        expect(resolveAvatarBakePortrait({ entry: null, pose: null, profile })).toBe(profile);
    });
});

describe("avatarBakeInputs", () => {
    function narra(): Character {
        return Character.fromJSON({
            profile: {
                id: "c1",
                name: "Narra",
                description: "",
                tags: [],
                attributes: {},
                nicknames: [],
                thumbnail: null,
                appearance: { kind: "preset", defaultPoseId: "p1", poses: [{ id: "p1", name: "Default", assetId: "a1" }], avatars: {} },
            },
        } as never);
    }

    it("does not move when a bake records its own stamp, so a bake never schedules the next one", () => {
        const character = narra();
        const before = avatarBakeInputs([character]);
        character.profile.appearance.setAvatar("p1", { baked: "fe5f2877" });
        expect(avatarBakeInputs([character])).toBe(before);
        character.profile.appearance.setAvatar("p1", null);
        expect(avatarBakeInputs([character])).toBe(before);
    });

    it("moves for every edit that changes what a bake draws or how it is framed", () => {
        const character = narra();
        const seen = new Set([avatarBakeInputs([character])]);
        const appearance = character.profile.appearance;
        const pose = appearance.createPose("Smile")!;
        seen.add(avatarBakeInputs([character]));
        appearance.setPoseAsset(pose.id, "a2");
        seen.add(avatarBakeInputs([character]));
        appearance.setPosePortrait(pose.id, { x: 0.4, y: 0, w: 0.3, h: 0.3 });
        seen.add(avatarBakeInputs([character]));
        character.profile.setPortrait({ x: 0.45, y: 0.01, w: 0.38, h: 0.35 });
        seen.add(avatarBakeInputs([character]));
        appearance.setAvatarPortrait("p1", { x: 0.5, y: 0, w: 0.2, h: 0.2 });
        seen.add(avatarBakeInputs([character]));
        expect(seen.size).toBe(6);
    });
});

/**
 * The bake that runs before Dev Mode, Preview or a build reads the project.
 *
 * Without it a bake made by an older rule went on showing and shipping in every project whose author
 * never opened the character panel. It runs a pass only when none has run on the cast as it stands,
 * so a launch after the panel baked - or after a previous launch did - does nothing.
 */
describe("bakeStaleAvatarsBeforeLaunch", () => {
    /** One character whose only pose draws `assetId` - what a bake reads, unlike her name. */
    function castOf(assetId: string) {
        const character = Character.fromJSON({
            profile: {
                id: "c1",
                name: "Narra",
                description: "",
                tags: [],
                attributes: {},
                nicknames: [],
                thumbnail: null,
                appearance: { kind: "preset", defaultPoseId: "p1", poses: [{ id: "p1", name: "Default", assetId }], avatars: {} },
            },
        } as never);
        return { listCharacter: () => [character] };
    }

    beforeEach(() => {
        resetAvatarBakeStateForTests();
    });

    it("runs a pass on a project no bake has run on in this window", async () => {
        const bake = vi.fn(async () => undefined);
        expect(await bakeStaleAvatarsBeforeLaunch({ characters: castOf("a1"), frozen: false, bake })).toBe(true);
        expect(bake).toHaveBeenCalledTimes(1);
    });

    it("runs none again until the cast changes", async () => {
        const bake = vi.fn(async () => undefined);
        const cast = castOf("a1");
        await bakeStaleAvatarsBeforeLaunch({ characters: cast, frozen: false, bake });
        expect(await bakeStaleAvatarsBeforeLaunch({ characters: cast, frozen: false, bake })).toBe(false);
        expect(await bakeStaleAvatarsBeforeLaunch({ characters: castOf("a2"), frozen: false, bake })).toBe(true);
        expect(bake).toHaveBeenCalledTimes(2);
    });

    it("writes nothing while the workspace is frozen", async () => {
        const bake = vi.fn(async () => undefined);
        expect(await bakeStaleAvatarsBeforeLaunch({ characters: castOf("a1"), frozen: true, bake })).toBe(false);
        expect(bake).not.toHaveBeenCalled();
    });

    it("tries again on the next launch when a pass fails", async () => {
        const failing = vi.fn(async () => {
            throw new Error("disk full");
        });
        const cast = castOf("a1");
        await expect(bakeStaleAvatarsBeforeLaunch({ characters: cast, frozen: false, bake: failing })).rejects.toThrow("disk full");
        const bake = vi.fn(async () => undefined);
        expect(await bakeStaleAvatarsBeforeLaunch({ characters: cast, frozen: false, bake })).toBe(true);
    });
});
