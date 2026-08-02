import { describe, expect, it } from "vitest";
import { findCanonicalJsonDefect } from "@shared/documents/canonicalJson";
import { charactersSpec } from "@shared/documents/specs";
import { CHARACTER_STORE_VERSION, type CharacterStoreDocument } from "@shared/characters/characterStoreModel";
import { CharacterProfile } from "./CharacterProfile";

/**
 * The audit, as a test.
 *
 * `editor/services/character.json` used to be written with `JSON.stringify`, which drops an
 * `undefined` property without a word. It is written by the canonical encoder now, which **throws**
 * on one - so an `undefined` that was invisible for two years becomes a cast that cannot be saved at
 * all, and it surfaces as "the characters spec is broken" rather than as "your file is corrupt".
 * The known sites were fixed (`CharacterProfile.create`/`fromJSON`/`toJSON`,
 * `CharacterAppearance.cloneAppearance`/`createPose`, and `migrateLegacyAppearance`, which is the
 * worst of them because a migration reaches every project that has not been opened since the
 * appearance rework).
 *
 * This is the guard against the next one. It drives the profile and appearance through the states
 * where an optional field is absent - which is where every one of those bugs lived - and asserts the
 * store that comes out is encodable. Grepping for `: undefined` would not have caught most of them:
 * `groupId: config.groupId` writes the key just as surely when the source has none.
 */

function storeOf(...profiles: CharacterProfile[]): CharacterStoreDocument {
    return {
        version: CHARACTER_STORE_VERSION,
        characters: profiles.map(profile => ({ profile: profile.toJSON() })),
        groups: {},
    };
}

/** Encodable, and encodable through the spec that actually writes it. */
function expectSavable(store: CharacterStoreDocument): void {
    const defect = findCanonicalJsonDefect(store);
    expect(defect?.message ?? null).toBeNull();
    expect(() => charactersSpec.serialize(store)).not.toThrow();
}

describe("the character store can be written as canonical JSON", () => {
    it("holds for a freshly created character of every kind", () => {
        for (const kind of ["preset", "layered", "puppet", "live2d", "spine"] as const) {
            expectSavable(storeOf(CharacterProfile.create(`id-${kind}`, `Name ${kind}`, kind)));
        }
    });

    it("holds for a preset character whose pose has no folder and no crop", () => {
        const profile = CharacterProfile.create("alice", "Alice", "preset");
        profile.appearance.createPose("angry");

        const store = storeOf(profile);
        const pose = (store.characters[0].profile.appearance as unknown as { poses: Record<string, unknown>[] }).poses[0];
        // "No folder" has to be an absent key. `folder: undefined` reads identically in TypeScript
        // and is a document that cannot be saved.
        expect("folder" in pose).toBe(false);
        expectSavable(store);
    });

    it("holds for a layered character whose layer is bound to nothing", () => {
        const profile = CharacterProfile.create("alice", "Alice", "layered");
        profile.appearance.createLayer("face");

        const store = storeOf(profile);
        const layer = (store.characters[0].profile.appearance as unknown as { layers: Record<string, unknown>[] }).layers[0];
        expect("options" in layer).toBe(false);
        expectSavable(store);
    });

    it("holds for every optional profile field, absent and then set and then cleared again", () => {
        const profile = CharacterProfile.create("alice", "Alice", "preset");
        for (const key of ["groupId", "color", "portrait", "defaultAvatarAssetId", "voiceTrackId"]) {
            expect(key in profile.toJSON()).toBe(false);
        }
        expectSavable(storeOf(profile));

        profile.setGroupId("g1");
        profile.setColor("#40a8c4");
        profile.setPortrait({ x: 0, y: 0, w: 1, h: 1 });
        profile.setDefaultAvatarAssetId("avatar-1");
        profile.setVoiceTrackId("track-1");
        expectSavable(storeOf(profile));

        // Clearing is the state that used to break: every one of these setters takes `undefined` or
        // `null` for "none", and the old `toJSON` turned that into a key holding `undefined`.
        profile.setGroupId(undefined);
        profile.setColor(undefined);
        profile.setPortrait(undefined);
        profile.setDefaultAvatarAssetId(null);
        profile.setVoiceTrackId(null);
        expectSavable(storeOf(profile));
    });

    it("holds for a profile rebuilt from a stored one that never had the optional fields", () => {
        // `fromJSON` used to re-state `groupId` on top of the spread, which added the key back as
        // `undefined` for every ungrouped character on every single load.
        const rebuilt = CharacterProfile.fromJSON(CharacterProfile.create("alice", "Alice").toJSON());

        expect("groupId" in rebuilt.toJSON()).toBe(false);
        expectSavable(storeOf(rebuilt));
    });
});
