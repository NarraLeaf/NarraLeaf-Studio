import { describe, expect, it } from "vitest";
import { storyAppearanceLabel, type StoryAppearanceSelection } from "./storyAppearanceLabel";

const REFS: Record<string, { id: string; name: string }[]> = {
    alice: [
        { id: "pro5swd", name: "平常" },
        { id: "pos-angry", name: "生气" },
    ],
    inko: [
        { id: "p8edj8l", name: "微笑" },
        { id: "tag-uniform", name: "制服" },
    ],
};

/** The same lookup the command line resolves a typed `/face` against. */
const appearanceName = (characterId: string, refId: string) =>
    REFS[characterId]?.find(ref => ref.id === refId)?.name ?? null;

function selection(extra: StoryAppearanceSelection): StoryAppearanceSelection {
    return extra;
}

describe("storyAppearanceLabel — what an inline expression switch says", () => {
    it("names a preset character's pose, never its id", () => {
        expect(storyAppearanceLabel(selection({ characterId: "alice", pose: "pro5swd" }), appearanceName)).toBe("平常");
    });

    it("names every axis a layered row touched, not just the first", () => {
        // The whole content of this chip is "what changed here", and a row that changed two axes
        // changed both — unlike the command line's single `form` slot, which declines to pick one.
        const label = storyAppearanceLabel(
            selection({ characterId: "inko", tags: { mood: "p8edj8l", outfit: "tag-uniform" } }),
            appearanceName,
        );
        expect(label).toBe("微笑 · 制服");
    });

    it("reads a puppet's expression back as itself — there is no table to look it up in", () => {
        expect(storyAppearanceLabel(selection({ characterId: "puppet", puppetName: "angry_02" }), appearanceName)).toBe("angry_02");
    });

    it("answers null rather than an id when the reference resolves to nothing", () => {
        // The regression this exists for: an unresolvable pose used to print `pro5swd` mid-paragraph.
        expect(storyAppearanceLabel(selection({ characterId: "alice", pose: "pos-deleted" }), appearanceName)).toBeNull();
        expect(storyAppearanceLabel(selection({ characterId: "nobody", pose: "pro5swd" }), appearanceName)).toBeNull();
        expect(storyAppearanceLabel(selection({ characterId: "inko", tags: { mood: "gone" } }), appearanceName)).toBeNull();
    });

    it("answers null for a row that names no appearance at all", () => {
        expect(storyAppearanceLabel(selection({ characterId: "alice" }), appearanceName)).toBeNull();
        expect(storyAppearanceLabel(selection({}), appearanceName)).toBeNull();
    });

    it("answers null — not an id — for a surface that has no lookup to resolve against", () => {
        expect(storyAppearanceLabel(selection({ characterId: "alice", pose: "pro5swd" }), undefined)).toBeNull();
        // A puppet still reads back: its name never needed the lookup.
        expect(storyAppearanceLabel(selection({ characterId: "doll", puppetName: "angry_02" }), undefined)).toBe("angry_02");
    });

    it("drops the axes it could not name and keeps the ones it could", () => {
        const label = storyAppearanceLabel(
            selection({ characterId: "inko", tags: { mood: "p8edj8l", outfit: "gone" } }),
            appearanceName,
        );
        expect(label).toBe("微笑");
    });
});
