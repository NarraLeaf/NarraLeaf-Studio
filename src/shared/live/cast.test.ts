import { describe, expect, it } from "vitest";
import type { CharacterGroup, StoredCharacter } from "@shared/types/character/model";
import { castDigest, characterAt, characterRecordDigest, type LiveCastView } from "./cast";

function record(id: string, name = id, groupId?: string): StoredCharacter {
    return {
        profile: {
            id,
            name,
            description: "",
            tags: [],
            attributes: {},
            thumbnail: null,
            nicknames: [],
            ...(groupId === undefined ? {} : { groupId }),
            appearance: { kind: "preset", poses: [], defaultPoseId: null },
        },
    };
}

const GROUP: CharacterGroup = { id: "g1", name: "Cast", createdAt: 1, updatedAt: 2 };

function cast(members: StoredCharacter[], groups: CharacterGroup[] = []): LiveCastView {
    return {
        characters: Object.fromEntries(members.map(member => [member.profile.id, member])),
        order: members.map(member => member.profile.id),
        groups: Object.fromEntries(groups.map(group => [group.id, group])),
    };
}

describe("one character's digest", () => {
    it("agrees for two copies of one record built in different key orders", () => {
        // The comparison has to survive key order or it reports a disagreement nobody can act on:
        // one copy was parsed off disk and the other adopted from a message.
        const parsed = { record: { profile: { id: "a", name: "Ada" } }, at: 0 };
        const adopted = { record: { profile: { name: "Ada", id: "a" } }, at: 0 };
        expect(characterRecordDigest(parsed as never)).toBe(characterRecordDigest(adopted as never));
    });

    it("differs when a field differs, which is the whole point of computing it", () => {
        expect(characterRecordDigest({ record: record("a", "Ada"), at: 0 }))
            .not.toBe(characterRecordDigest({ record: record("a", "Ada Lovelace"), at: 0 }));
    });

    it("differs when the record sits somewhere else in the cast", () => {
        // Creating a character changes two things - the record exists, and it sits somewhere - and a
        // digest over the record alone would let a machine that appended where everybody else
        // inserted pass unnoticed until the next rearrangement.
        expect(characterRecordDigest({ record: record("a"), at: 0 }))
            .not.toBe(characterRecordDigest({ record: record("a"), at: 1 }));
    });

    it("gives an absent record a value of its own rather than no value", () => {
        // The difference from a scene digest, where an unreadable scene answers null. Absence has to
        // be comparable, or the guard would rule `unproven` on exactly the effect that proves two
        // copies parted company.
        const absent = characterRecordDigest({ record: null, at: null });
        expect(absent).toMatch(/^[0-9a-f]{16}$/);
        expect(absent).not.toBe(characterRecordDigest({ record: record("a"), at: 0 }));
    });

    it("is short enough to ride on every effect", () => {
        expect(characterRecordDigest({ record: record("a"), at: 0 })).toMatch(/^[0-9a-f]{16}$/);
    });
});

describe("the cast's digest", () => {
    it("notices a member arriving, leaving, or moving", () => {
        const one = castDigest(cast([record("a"), record("b")]));
        expect(castDigest(cast([record("a")]))).not.toBe(one);
        expect(castDigest(cast([record("b"), record("a")]))).not.toBe(one);
    });

    it("notices a group appearing and its name changing", () => {
        const none = castDigest(cast([record("a")]));
        const named = castDigest(cast([record("a")], [GROUP]));
        expect(named).not.toBe(none);
        expect(castDigest(cast([record("a")], [{ ...GROUP, name: "Extras" }]))).not.toBe(named);
    });

    it("notices who is in which group, which no member's own digest reports", () => {
        // Deleting a group moves its members out, and no `update-character` is sent for any of them -
        // so without membership here that half of the operation would be fingerprinted by nothing.
        expect(castDigest(cast([record("a", "Ada", "g1")], [GROUP])))
            .not.toBe(castDigest(cast([record("a", "Ada")], [GROUP])));
    });

    it("says nothing about what is inside a member, which is the other digest's job", () => {
        // The split is what keeps both cheap: neither ever encodes the whole store.
        expect(castDigest(cast([record("a", "Ada")]))).toBe(castDigest(cast([record("a", "Renamed")])));
    });
});

describe("reading a character out of the cast", () => {
    it("answers the record and where it sits", () => {
        expect(characterAt(cast([record("a"), record("b")]), "b"))
            .toEqual({ record: record("b"), at: 1 });
    });

    it("answers absence for a member the cast does not have", () => {
        expect(characterAt(cast([record("a")]), "stranger")).toEqual({ record: null, at: null });
    });
});
