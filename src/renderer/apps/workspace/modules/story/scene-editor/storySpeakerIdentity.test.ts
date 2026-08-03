import { describe, expect, it } from "vitest";
import {
    characterSpeakerIdentity,
    narratorSpeakerIdentity,
    storySpeakerHash,
    storySpeakerHue,
    storySpeakerInitial,
} from "./storySpeakerIdentity";

describe("storySpeakerHash", () => {
    it("keeps a name on one hue", () => {
        expect(storySpeakerHash("Anyo")).toBe(storySpeakerHash("Anyo"));
    });

    it("stays inside the hue circle", () => {
        for (const name of ["Anyo", "绫波丽", "小林", "Kaede", "夜见", "Theo", "", "?????"]) {
            const hue = storySpeakerHash(name);
            expect(hue, name).toBeGreaterThanOrEqual(0);
            expect(hue, name).toBeLessThan(360);
            expect(Number.isInteger(hue), name).toBe(true);
        }
    });

    it("separates the names an author is most likely to have side by side", () => {
        const hues = ["Anyo", "绫波丽", "小林", "Kaede"].map(storySpeakerHash);
        expect(new Set(hues).size).toBe(hues.length);
    });

    /**
     * The promise §4 makes is cross-project: copy a scene elsewhere and the cast keeps its colours.
     * Pinning the values is the only thing that can catch a "harmless" rewrite of the hash.
     */
    it("is the FNV-1a of 规范 §4, pinned", () => {
        expect(storySpeakerHash("Anyo")).toBe(70);
        expect(storySpeakerHash("绫波丽")).toBe(183);
    });
});

describe("storySpeakerHue", () => {
    it("falls back to the name when no colour is set", () => {
        expect(storySpeakerHue("Anyo")).toBe(storySpeakerHash("Anyo"));
    });

    it("takes the hue of a colour the author picked", () => {
        // Studio's brand anchor #40a8c4 is a cyan a shade past 192°.
        expect(storySpeakerHue("Anyo", "#40a8c4")).toBe(193);
        expect(storySpeakerHue("Anyo", "#ff0000")).toBe(0);
        expect(storySpeakerHue("Anyo", "#00ff00")).toBe(120);
    });

    it("reads shorthand hex", () => {
        expect(storySpeakerHue("Anyo", "#f00")).toBe(0);
    });

    /** A grey has no hue to take, and 0 would silently mean red. */
    it("falls back to the name hash for greys and unparseable colours", () => {
        expect(storySpeakerHue("Anyo", "#808080")).toBe(storySpeakerHash("Anyo"));
        expect(storySpeakerHue("Anyo", "not a colour")).toBe(storySpeakerHash("Anyo"));
    });
});

describe("storySpeakerInitial", () => {
    it("takes one CJK character", () => {
        expect(storySpeakerInitial("绫波丽")).toBe("绫");
        expect(storySpeakerInitial("夜见")).toBe("夜");
    });

    it("takes up to two Latin letters", () => {
        expect(storySpeakerInitial("Anyo")).toBe("An");
        expect(storySpeakerInitial("K")).toBe("K");
    });

    it("does not romanise", () => {
        expect(storySpeakerInitial("小林")).not.toBe("X");
    });

    it("keeps an astral first character whole", () => {
        expect(storySpeakerInitial("🌙夜")).toBe("🌙");
    });

    it("has something to draw for an unnamed speaker", () => {
        expect(storySpeakerInitial("")).toBe("?");
        expect(storySpeakerInitial("   ")).toBe("?");
    });
});

describe("speaker identities", () => {
    /**
     * §3.1, the rule the whole vocabulary rests on: a character with no artwork is still a person, so
     * it must be solid. Falling back to the ring would put a person in the narrator's shape.
     */
    it("keeps a character solid whether or not they have artwork", () => {
        expect(characterSpeakerIdentity("Anyo", { hasPortrait: true }).kind).toBe("portrait");
        expect(characterSpeakerIdentity("Anyo", { hasPortrait: false }).kind).toBe("disc");
    });

    it("gives a character the same hue with and without artwork", () => {
        expect(characterSpeakerIdentity("Anyo", { hasPortrait: true }).hue)
            .toBe(characterSpeakerIdentity("Anyo", { hasPortrait: false }).hue);
    });

    /** §4: the narrator is a voice, not a member of the cast, and takes no hue at all. */
    it("leaves the narrator hueless and hollow", () => {
        const narrator = narratorSpeakerIdentity("Narrator");
        expect(narrator.kind).toBe("ring");
        expect(narrator.hue).toBeNull();
    });
});
