import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    BRAND_LINK_MAX_DEPTH,
    BrandPalette,
    getActiveBrandPalette,
    getActiveBrandPaletteRevision,
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

    it("compounds the alpha of every link it passes through", () => {
        const palette = new BrandPalette([
            color("primary", "#40A8C4"),
            color("half", "nlbrand:primary/0.5"),
            color("quarter", "nlbrand:half/0.5"),
            color("shadow", "rgba(0, 0, 0, 0.35)"),
            color("halfShadow", "nlbrand:shadow/0.5"),
        ]);

        expect(palette.resolveCss("half")).toBe("rgba(64, 168, 196, 0.5)");
        expect(palette.resolveCss("quarter")).toBe("rgba(64, 168, 196, 0.25)");
        // The literal's own alpha is part of the product, not something the link replaces.
        expect(palette.resolveCss("halfShadow")).toBe("rgba(0, 0, 0, 0.175)");
    });

    it("expands the short and eight-digit hex forms before applying an alpha", () => {
        const palette = new BrandPalette([
            color("short", "#abc"),
            color("eight", "#00000080"),
            color("halfShort", "nlbrand:short/0.5"),
            color("halfEight", "nlbrand:eight/0.5"),
        ]);

        expect(palette.resolveCss("halfShort")).toBe("rgba(170, 187, 204, 0.5)");
        expect(palette.resolveCss("halfEight")).toBe("rgba(0, 0, 0, 0.251)");
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
