import { describe, expect, it } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import { groupSpeakerCandidates, type GroupableSpeakerCandidate, type SpeakerPickerEntry } from "./speakerCandidateGroups";

function candidate(id: string, name: string, groupId?: string): GroupableSpeakerCandidate & { name: string } {
    const profile = CharacterProfile.create(id, name);
    profile.setGroupId(groupId);
    return { key: id, kind: "character", character: Character.fromJSON({ profile: profile.toJSON() }), name };
}

function temp(name: string): GroupableSpeakerCandidate & { name: string } {
    return { key: `name:${name}`, kind: "temp", name };
}

const npc = new Map([["g-npc", "NPC"]]);

/** Each header's name, keyed by the candidate drawn right under it. */
function headersAbove(entries: readonly SpeakerPickerEntry<{ key: string }>[]) {
    const headers = new Map<string, string>();
    entries.forEach((entry, index) => {
        const next = entries[index + 1];
        if (entry.kind === "label" && next?.kind === "candidate") {
            headers.set(next.candidate.key, entry.name);
        }
    });
    return headers;
}

describe("groupSpeakerCandidates", () => {
    it("lists the ungrouped cast first, then each group under its name", () => {
        const grouped = groupSpeakerCandidates([candidate("a", "A", "g-npc"), candidate("b", "B")], npc);

        expect(grouped.ordered.map(entry => entry.name)).toEqual(["B", "A"]);
        expect(headersAbove(grouped.entries).get("a")).toBe("NPC");
        expect(headersAbove(grouped.entries).has("b")).toBe(false);
    });

    it("keeps the group list's own order, and heads only the groups with a member on show", () => {
        const groups = new Map([["g-1", "Chapter one"], ["g-2", "Chapter two"]]);
        const grouped = groupSpeakerCandidates([candidate("b", "B", "g-2"), candidate("a", "A", "g-1")], groups);

        expect(grouped.ordered.map(entry => entry.name)).toEqual(["A", "B"]);
        expect([...headersAbove(grouped.entries).values()]).toEqual(["Chapter one", "Chapter two"]);
    });

    it("leaves bare names at the end, where the name being typed has to stay", () => {
        const grouped = groupSpeakerCandidates([candidate("a", "Al", "g-npc"), temp("Alfred"), temp("Al")], npc);

        expect(grouped.ordered.map(entry => entry.name)).toEqual(["Al", "Alfred", "Al"]);
        expect(grouped.ordered[grouped.ordered.length - 1].kind).toBe("temp");
    });

    // A group deleted while the picker is open, and a project with no groups at all, are the same
    // case: nothing is filed, so the order is exactly the one the candidates arrived in.
    it("files a character whose group is gone with the ungrouped, in the order given", () => {
        const grouped = groupSpeakerCandidates([candidate("a", "A", "g-dropped"), candidate("b", "B")], npc);

        expect(grouped.ordered.map(entry => entry.name)).toEqual(["A", "B"]);
        expect(grouped.entries.every(entry => entry.kind === "candidate")).toBe(true);
    });

    it("makes each group one entry with its members inside it, as submenus", () => {
        const groups = new Map([["g-1", "Leads"], ["g-2", "Extras"]]);
        const grouped = groupSpeakerCandidates(
            [candidate("a", "A", "g-1"), candidate("b", "B", "g-2"), candidate("c", "C", "g-2"), candidate("d", "D"), temp("E")],
            groups,
            "submenus",
        );

        expect(grouped.entries.map(entry => entry.kind === "candidate"
            ? entry.candidate.name
            : `[${entry.name}: ${entry.kind === "group" ? entry.members.map(member => member.name).join(",") : ""}]`))
            .toEqual(["D", "[Leads: A]", "[Extras: B,C]", "E"]);
    });
});
