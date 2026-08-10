import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    BRAND_LINK_MAX_DEPTH,
    BrandPalette,
    getActiveBrandPalette,
    getActiveBrandPaletteRevision,
    resolveBrandColorValue,
    setActiveBrandPalette,
    subscribeActiveBrandPalette,
} from "./brandRegistry";
import { BUILTIN_BRAND_COLORS, type BrandColor } from "@shared/types/brand";

const color = (id: string, value: string): BrandColor => ({ id, value });

/** `l0 -> l1 -> ... -> l<links>`, where the last one holds a literal. */
function chainPalette(links: number): BrandPalette {
    const colors: BrandColor[] = [];
    for (let index = 0; index < links; index += 1) {
        colors.push(color(`l${index}`, `nlbrand:l${index + 1}`));
    }
    colors.push(color(`l${links}`, "#010203"));
    return new BrandPalette(colors);
}

describe("BrandPalette resolution", () => {
    const seeds = new BrandPalette(BUILTIN_BRAND_COLORS);

    it("returns a literal as it stands", () => {
        expect(seeds.resolveCss("primary")).toBe("#40A8C4");
        expect(seeds.resolveCss("button.shadow")).toBe("rgba(0, 0, 0, 0.35)");
    });

    it("follows one link", () => {
        expect(seeds.resolveCss("button.primary")).toBe("#40A8C4");
        expect(seeds.resolveCss("text.primary")).toBe("#F2F4F7");
    });

    it("follows a link through a link", () => {
        const palette = new BrandPalette([
            color("primary", "#40A8C4"),
            color("button.primary", "nlbrand:primary"),
            color("mine", "nlbrand:button.primary"),
        ]);

        expect(palette.resolveCss("mine")).toBe("#40A8C4");
    });

    it("answers null instead of throwing for every way there is no colour", () => {
        expect(new BrandPalette([]).resolveCss("primary")).toBeNull();
        // Points at nothing.
        expect(new BrandPalette([color("a", "nlbrand:gone")]).resolveCss("a")).toBeNull();
        // Points at itself.
        expect(new BrandPalette([color("a", "nlbrand:a")]).resolveCss("a")).toBeNull();
        // Two pointing at each other, asked from both ends.
        const mutual = new BrandPalette([color("a", "nlbrand:b"), color("b", "nlbrand:a")]);
        expect(mutual.resolveCss("a")).toBeNull();
        expect(mutual.resolveCss("b")).toBeNull();
        // A ring the asked-for id is not itself part of.
        const ring = new BrandPalette([
            color("a", "nlbrand:b"),
            color("b", "nlbrand:c"),
            color("c", "nlbrand:b"),
        ]);
        expect(ring.resolveCss("a")).toBeNull();
    });

    it("follows exactly as far as the depth limit and no further", () => {
        expect(chainPalette(BRAND_LINK_MAX_DEPTH).resolveCss("l0")).toBe("#010203");
        expect(chainPalette(BRAND_LINK_MAX_DEPTH + 1).resolveCss("l0")).toBeNull();
    });

    /**
     * The alpha ruling, from the id end. Every link in a chain is a number an author set in an
     * opacity slider - the Brand panel edits the control colours through the same picker as any
     * other field - so the slider's number has to be the stored number. Multiplying made opening and
     * closing the panel fade the colour one notch each time.
     */
    it("takes the outermost written alpha as final and does not multiply the chain", () => {
        const palette = new BrandPalette([
            color("primary", "#40A8C4"),
            color("half", "nlbrand:primary/0.5"),
            color("quarter", "nlbrand:half/0.5"),
            color("shadow", "rgba(0, 0, 0, 0.35)"),
            color("halfShadow", "nlbrand:shadow/0.5"),
        ]);

        expect(palette.resolveCss("half")).toBe("rgba(64, 168, 196, 0.5)");
        // 0.5, not 0.5 * 0.5: the inner segment is passed over once an outer one has spoken.
        expect(palette.resolveCss("quarter")).toBe("rgba(64, 168, 196, 0.5)");
        // 0.5 replaces the literal's own 0.35 rather than scaling it to 0.175.
        expect(palette.resolveCss("halfShadow")).toBe("rgba(0, 0, 0, 0.5)");
        // No segment anywhere leaves the literal exactly as the author wrote it.
        expect(palette.resolveCss("shadow")).toBe("rgba(0, 0, 0, 0.35)");
    });

    /**
     * A hand-written `/1` is the one way to say "this brand colour, opaque". Studio never writes it
     * (`formatBrandLink` drops a full-opacity segment), but the grammar accepts it, and replacement
     * is what makes it mean anything at all.
     */
    it("reads a written `/1` as opaque rather than as no opinion", () => {
        const palette = new BrandPalette([
            color("shadow", "rgba(0, 0, 0, 0.35)"),
            color("solidShadow", "nlbrand:shadow/1"),
        ]);

        expect(palette.resolveCss("solidShadow")).toBe("rgba(0, 0, 0, 1)");
    });

    it("expands the short and eight-digit hex forms before replacing an alpha", () => {
        const palette = new BrandPalette([
            color("short", "#abc"),
            color("eight", "#00000080"),
            color("halfShort", "nlbrand:short/0.5"),
            color("halfEight", "nlbrand:eight/0.5"),
        ]);

        expect(palette.resolveCss("halfShort")).toBe("rgba(170, 187, 204, 0.5)");
        // The eight-digit form's own 0.502 is replaced, not multiplied into 0.251.
        expect(palette.resolveCss("halfEight")).toBe("rgba(0, 0, 0, 0.5)");
    });

    /**
     * A literal this module cannot decompose keeps its alpha rather than being guessed at. Losing
     * the transparency leaves a colour that is visibly wrong; inventing channels for a name it does
     * not know would put a colour on screen nobody chose.
     */
    it("leaves a literal it cannot read alone rather than inventing one", () => {
        const palette = new BrandPalette([
            color("named", "rebeccapurple"),
            color("halfNamed", "nlbrand:named/0.5"),
        ]);

        expect(palette.resolveCss("halfNamed")).toBe("rebeccapurple");
    });

    it("reads entries back and keeps the order it was given", () => {
        const palette = new BrandPalette([color("b", "#000000"), color("a", "#ffffff")]);

        expect(palette.list().map(entry => entry.id)).toEqual(["b", "a"]);
        expect(palette.get("a")?.value).toBe("#ffffff");
        expect(palette.get("gone")).toBeUndefined();
    });
});

/**
 * The operation the three hosts share: hand it a stored value, get back something paintable.
 *
 * These six rows are the whole alpha contract. They are asserted here rather than only through the
 * callers because the canvas, the shipped game and the shell's pre-boot frame each used to answer
 * them separately, and the same stored string came out as two different colours.
 */
describe("BrandPalette.resolveValueCss", () => {
    const seeds = new BrandPalette(BUILTIN_BRAND_COLORS);
    // `button.shadow` is seeded as `rgba(0, 0, 0, 0.35)` and `button.primary` as `nlbrand:primary`.

    it("hands back a value that is not a link untouched", () => {
        expect(seeds.resolveValueCss("#40A8C4")).toBe("#40A8C4");
        expect(seeds.resolveValueCss("rgba(1, 2, 3, 0.4)")).toBe("rgba(1, 2, 3, 0.4)");
        expect(seeds.resolveValueCss("rebeccapurple")).toBe("rebeccapurple");
        // Not a colour, so not an answer - and notably not the empty string.
        expect(seeds.resolveValueCss("   ")).toBeNull();
    });

    it("paints a link with no segment at the entry's own opacity", () => {
        expect(seeds.resolveValueCss("nlbrand:button.shadow")).toBe("rgba(0, 0, 0, 0.35)");
    });

    it("lets a written segment replace the entry's own opacity, rather than multiplying it", () => {
        // 0.5, not 0.5 * 0.35 = 0.175. The slider that wrote this showed 50%.
        expect(seeds.resolveValueCss("nlbrand:button.shadow/0.5")).toBe("rgba(0, 0, 0, 0.5)");
    });

    it("follows a chain of links to the literal at the end", () => {
        expect(seeds.resolveValueCss("nlbrand:button.primary")).toBe("#40A8C4");
    });

    it("applies a segment to the literal a chain ends at", () => {
        expect(seeds.resolveValueCss("nlbrand:button.primary/0.5")).toBe("rgba(64, 168, 196, 0.5)");
    });

    it("takes the stored value's own segment over one written inside the palette", () => {
        const palette = new BrandPalette([
            color("primary", "#40A8C4"),
            color("a", "nlbrand:primary/0.5"),
        ]);

        // 0.8, not 0.8 * 0.5 = 0.4: the outermost slider is the one the author last touched.
        expect(palette.resolveValueCss("nlbrand:a/0.8")).toBe("rgba(64, 168, 196, 0.8)");
        // ...and with nothing written outside, the entry's own segment is the answer.
        expect(palette.resolveValueCss("nlbrand:a")).toBe("rgba(64, 168, 196, 0.5)");
    });

    it("answers null for a link that leads nowhere, exactly as resolveCss does", () => {
        const palette = new BrandPalette([color("a", "nlbrand:a"), color("b", "nlbrand:gone")]);

        expect(palette.resolveValueCss("nlbrand:missing")).toBeNull();
        expect(palette.resolveValueCss("nlbrand:a")).toBeNull();
        expect(palette.resolveValueCss("nlbrand:b")).toBeNull();
    });

    /**
     * Resolving a value costs the same depth as resolving the id it names. It used to cost one more,
     * because the only way to ask this question was to park the value in the palette as an entry of
     * its own and resolve that.
     */
    it("spends no depth on the value itself", () => {
        expect(chainPalette(BRAND_LINK_MAX_DEPTH).resolveValueCss("nlbrand:l0")).toBe("#010203");
        expect(chainPalette(BRAND_LINK_MAX_DEPTH + 1).resolveValueCss("nlbrand:l0")).toBeNull();
    });

    it("refuses a malformed link rather than repairing it", () => {
        // Out of range, so `parseBrandLink` says it is not a link at all - and a value this module
        // cannot read is handed back as the literal it is not, to fail in the caller's own parser.
        expect(seeds.resolveValueCss("nlbrand:primary/5")).toBe("nlbrand:primary/5");
    });
});

describe("BrandPalette.chainOf", () => {
    it("names the ids a resolve passes through, excluding the one it started at", () => {
        const palette = new BrandPalette([
            color("a", "nlbrand:b"),
            color("b", "nlbrand:c"),
            color("c", "#000000"),
        ]);

        expect(palette.chainOf("a")).toEqual(["b", "c"]);
        expect(palette.chainOf("b")).toEqual(["c"]);
        expect(palette.chainOf("c")).toEqual([]);
    });

    it("stops at a repeat instead of walking a ring forever", () => {
        expect(new BrandPalette([color("a", "nlbrand:a")]).chainOf("a")).toEqual([]);
        const mutual = new BrandPalette([color("a", "nlbrand:b"), color("b", "nlbrand:a")]);
        expect(mutual.chainOf("a")).toEqual(["b"]);
    });

    it("names an id nothing defines, because the panel is still choosing between ids", () => {
        expect(new BrandPalette([color("a", "nlbrand:gone")]).chainOf("a")).toEqual(["gone"]);
    });

    it("is bounded even when the resolve would be", () => {
        expect(chainPalette(BRAND_LINK_MAX_DEPTH + 4).chainOf("l0")).toHaveLength(BRAND_LINK_MAX_DEPTH);
    });
});

describe("the active palette", () => {
    beforeEach(() => {
        setActiveBrandPalette(BUILTIN_BRAND_COLORS);
    });

    it("is the seeds until a host publishes one", () => {
        expect(getActiveBrandPalette().resolveCss("primary")).toBe("#40A8C4");
    });

    it("takes what a host publishes", () => {
        setActiveBrandPalette([...BUILTIN_BRAND_COLORS.filter(entry => entry.id !== "primary"),
            color("primary", "#FF0000")]);

        expect(getActiveBrandPalette().resolveCss("primary")).toBe("#FF0000");
        expect(getActiveBrandPalette().resolveCss("button.primary")).toBe("#FF0000");
    });

    /**
     * The one that keeps the canvas still. Hosts publish from a document-changed subscription, which
     * fires for every edit anywhere in the project; a revision bumped by an identical palette would
     * repaint every widget on screen on every keystroke in the story editor.
     */
    it("does not move the revision for a palette that says the same thing", () => {
        const before = getActiveBrandPaletteRevision();
        const listener = vi.fn();
        const unsubscribe = subscribeActiveBrandPalette(listener);

        setActiveBrandPalette(BUILTIN_BRAND_COLORS.map(entry => ({ ...entry })));

        expect(getActiveBrandPaletteRevision()).toBe(before);
        expect(listener).not.toHaveBeenCalled();

        setActiveBrandPalette([color("primary", "#FF0000")]);

        expect(getActiveBrandPaletteRevision()).toBe(before + 1);
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it("stops notifying an unsubscribed listener", () => {
        const listener = vi.fn();
        subscribeActiveBrandPalette(listener)();

        setActiveBrandPalette([color("primary", "#00FF00")]);

        expect(listener).not.toHaveBeenCalled();
    });

    it("is not changed by a caller mutating the array it published", () => {
        const published = [color("primary", "#FF0000")];
        setActiveBrandPalette(published);
        published.push(color("secondary", "#00FF00"));

        expect(getActiveBrandPalette().get("secondary")).toBeUndefined();
    });
});

/**
 * The named entry point the readers use, and the reason it has a name at all.
 *
 * Every caller of this is a surface with a colour guard of its own - `isReadableAccentColor`,
 * `CHARACTER_ACCENT_HEX`, `normalizeHex` - and all three correctly refuse `nlbrand:primary`, which is
 * the safety net an un-migrated field is rolled out behind. This is the one call that comes *before*
 * such a guard, so what these rows pin is that it hands the guard a literal and never anything the
 * guard has to have been taught about.
 */
describe("resolveBrandColorValue", () => {
    beforeEach(() => {
        setActiveBrandPalette(BUILTIN_BRAND_COLORS);
    });

    it("hands back a value that is not a link, so an ordinary field is unaffected", () => {
        expect(resolveBrandColorValue("#40A8C4")).toBe("#40A8C4");
        expect(resolveBrandColorValue("rgba(1, 2, 3, 0.4)")).toBe("rgba(1, 2, 3, 0.4)");
        // Trimmed, because the guard downstream is anchored and a stray space would fail it.
        expect(resolveBrandColorValue("  #40A8C4  ")).toBe("#40A8C4");
    });

    it("follows a link, and a chain of them, into the live palette", () => {
        expect(resolveBrandColorValue("nlbrand:primary")).toBe("#40A8C4");
        // `button.primary` is itself `nlbrand:primary`.
        expect(resolveBrandColorValue("nlbrand:button.primary")).toBe("#40A8C4");

        setActiveBrandPalette([...BUILTIN_BRAND_COLORS, color("cast.alice", "nlbrand:primary")]);

        expect(resolveBrandColorValue("nlbrand:cast.alice")).toBe("#40A8C4");
    });

    it("reads the palette on every call rather than the one that was live at import", () => {
        setActiveBrandPalette([color("primary", "#FF0000")]);
        expect(resolveBrandColorValue("nlbrand:primary")).toBe("#FF0000");

        setActiveBrandPalette([color("primary", "#00FF00")]);
        expect(resolveBrandColorValue("nlbrand:primary")).toBe("#00FF00");
    });

    /**
     * Null for every way there is no colour, so a caller's `?? fallback` covers the lot. Notably
     * *not* the link text: handing `nlbrand:gone` back would put the token itself into whatever CSS
     * declaration the caller is filling, which paints nothing and says nothing.
     */
    it("answers null for a broken link, a ring, and a chain that runs too deep", () => {
        setActiveBrandPalette([
            color("selfish", "nlbrand:selfish"),
            color("a", "nlbrand:b"),
            color("b", "nlbrand:a"),
            color("dangling", "nlbrand:gone"),
        ]);

        expect(resolveBrandColorValue("nlbrand:missing")).toBeNull();
        expect(resolveBrandColorValue("nlbrand:selfish")).toBeNull();
        expect(resolveBrandColorValue("nlbrand:a")).toBeNull();
        expect(resolveBrandColorValue("nlbrand:dangling")).toBeNull();
        expect(resolveBrandColorValue(chainedLinkValue(BRAND_LINK_MAX_DEPTH + 1))).toBeNull();
    });

    /**
     * The states that mean "this field holds no colour". They must stay null rather than acquiring a
     * default: the callers that read a character's optional accent tell "unset" from "set to
     * something" by exactly this answer, and a resolver that invented a colour here would give every
     * uncoloured character one.
     */
    it("answers null for absent, empty and non-string values", () => {
        expect(resolveBrandColorValue(undefined)).toBeNull();
        expect(resolveBrandColorValue(null)).toBeNull();
        expect(resolveBrandColorValue("")).toBeNull();
        expect(resolveBrandColorValue("   ")).toBeNull();
    });

    it("carries the alpha rule through unchanged, rather than restating it", () => {
        // `button.shadow` is seeded as `rgba(0, 0, 0, 0.35)`; a written segment replaces that.
        expect(resolveBrandColorValue("nlbrand:button.shadow")).toBe("rgba(0, 0, 0, 0.35)");
        expect(resolveBrandColorValue("nlbrand:button.shadow/0.5")).toBe("rgba(0, 0, 0, 0.5)");
    });
});

/** `nlbrand:l0` against a palette `links` deep, published as a side effect. */
function chainedLinkValue(links: number): string {
    const colors: BrandColor[] = [];
    for (let index = 0; index < links; index += 1) {
        colors.push(color(`l${index}`, `nlbrand:l${index + 1}`));
    }
    colors.push(color(`l${links}`, "#010203"));
    setActiveBrandPalette(colors);
    return "nlbrand:l0";
}
