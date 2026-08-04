import { describe, expect, it } from "vitest";
import {
    characterSpeakerIdentity,
    narratorSpeakerIdentity,
    storySpeakerHash,
    storySpeakerInitial,
    storySpeakerPaint,
    unknownSpeakerIdentity,
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

describe("storySpeakerPaint", () => {
    /**
     * The point of the whole union: a colour somebody chose is painted as chosen. An earlier version
     * kept only its HUE and re-derived the rest from a fixed ladder, which answered `#c94f7c` with
     * its own idea of what that hue should look like — a hint taken, not a choice honoured.
     */
    it("paints an author's colour exactly as it was chosen", () => {
        const { style } = storySpeakerPaint({ source: "author", hex: "#c94f7c" });
        expect(style["--nl-speaker-disc" as keyof typeof style]).toBe("#c94f7c");
        expect(style["--nl-speaker-name" as keyof typeof style]).toBe("#c94f7c");
    });

    /** A pale pick needs dark ink and a deep one needs light ink — on BOTH themes, since the fill is fixed. */
    it("derives the disc's ink from the chosen colour rather than the theme", () => {
        const pale = storySpeakerPaint({ source: "author", hex: "#f2e6b8" });
        const deep = storySpeakerPaint({ source: "author", hex: "#2b1d4a" });
        expect(pale.style["--nl-speaker-ink" as keyof typeof pale.style]).toBe("rgb(27 33 41)");
        expect(deep.style["--nl-speaker-ink" as keyof typeof deep.style]).toBe("rgb(255 255 255)");
    });

    /**
     * A name-derived speaker publishes only its hue. Saturation and lightness stay in the stylesheet
     * because they FLIP with the theme, and Electron never dispatches the media query's change event
     * — so a JS mirror of them would go stale the first time an author switches theme.
     */
    it("hands a name-derived speaker its hue and nothing else", () => {
        const { style } = storySpeakerPaint({ source: "name", hue: 70 });
        expect(style["--nl-speaker-h" as keyof typeof style]).toBe(70);
        expect(style["--nl-speaker-disc" as keyof typeof style]).toBeUndefined();
    });

    it("sends the narrator down the neutral ramp with no colour of its own", () => {
        const { className, style } = storySpeakerPaint({ source: "none" });
        expect(className).toContain("nl-speaker-neutral");
        expect(Object.keys(style)).toHaveLength(0);
    });

    it("keeps every speaker on the class the stylesheet hangs its variables off", () => {
        for (const paint of [
            { source: "author", hex: "#c94f7c" },
            { source: "name", hue: 70 },
            { source: "none" },
        ] as const) {
            expect(storySpeakerPaint(paint).className, paint.source).toContain("nl-speaker");
        }
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

    it("gives a character the same colour with and without artwork", () => {
        expect(characterSpeakerIdentity("Anyo", { hasPortrait: true }).paint)
            .toEqual(characterSpeakerIdentity("Anyo", { hasPortrait: false }).paint);
    });

    it("takes the project's colour when there is one, and the name hash when there is not", () => {
        expect(characterSpeakerIdentity("Anyo", { hasPortrait: false, color: "#c94f7c" }).paint)
            .toEqual({ source: "author", hex: "#c94f7c" });
        expect(characterSpeakerIdentity("Anyo", { hasPortrait: false }).paint)
            .toEqual({ source: "name", hue: storySpeakerHash("Anyo") });
    });

    /** §4: the narrator is a voice, not a member of the cast, and takes no colour at all. */
    it("leaves the narrator colourless and hollow", () => {
        const narrator = narratorSpeakerIdentity("Narrator");
        expect(narrator.kind).toBe("ring");
        expect(narrator.paint).toEqual({ source: "none" });
    });

    /**
     * §3.1 held to even in the incomplete state: an unassigned line is a line somebody will say, so
     * it stays SOLID. Falling back to the ring would file it, at a glance, as narration.
     */
    it("keeps an unknown speaker solid, and neutral", () => {
        const unknown = unknownSpeakerIdentity("Unassigned character");
        expect(unknown.kind).toBe("disc");
        expect(unknown.paint).toEqual({ source: "none" });
    });
});
