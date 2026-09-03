import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, accentInk, normalizeAccentColor } from "./accent";

/**
 * The accent written on a surface, and the wiring that carries it there.
 *
 * `ui.accentColor` takes any hex, and the accent is drawn as a foreground — `text-primary`,
 * `border-primary` — at close to four hundred places. A pale accent on the light ladder, or a
 * near-black one on the dark ladder, has nothing between it and the surface, so `accentInk`
 * clamps the luminance per ladder. Three things have to keep holding:
 *
 *   - the five presets come out of it untouched, because they are the product's own look;
 *   - anything else clears the band, whichever ladder it lands on;
 *   - the band is measured against the surface the stylesheet actually paints.
 *
 * The last one is why this file reads styles.css and the Tailwind config rather than trusting the
 * numbers repeated inside `accent.ts`: the clamp runs before the first paint and has no computed
 * style to consult, so the only thing standing between it and a silent drift is a test that goes
 * and looks.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const STYLES = readFileSync(join(REPO_ROOT, "src", "renderer", "styles", "styles.css"), "utf8");

/** WCAG AA for body text — the same figure `accent.ts` clamps to. */
const AA_CONTRAST = 4.5;

function luminance(channels: readonly number[]): number {
    const linear = channels.map(value => {
        const srgb = value / 255;
        return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function parseChannels(value: string): number[] {
    return value.trim().split(/\s+/).map(Number);
}

function contrast(a: readonly number[], b: readonly number[]): number {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The value `--nl-surface` holds on each ladder, read out of the stylesheet.
 *
 * `:root` carries the dark ladder and the `prefers-color-scheme: light` block overrides it, so the
 * first match is the dark one and the second is the light one — the same order the browser sees.
 */
function surfaceChannels(): { dark: number[]; light: number[] } {
    const declarations = [...STYLES.matchAll(/--nl-surface:\s*([^;]+);/g)].map(match => match[1]);
    expect(declarations).toHaveLength(2);
    return { dark: parseChannels(declarations[0]), light: parseChannels(declarations[1]) };
}

const SURFACE = surfaceChannels();

/** The brand anchor, which is what the light ladder's ceiling is pinned to. */
const ANCHOR = parseChannels(ACCENT_PRESETS[0].channels);

/** A spread of accents nobody would call safe, plus a few ordinary ones. */
const SAMPLES = [
    "#f3f0a0", "#fafafa", "#ffffff", "#fffef0", "#e8ffe8", "#101010", "#000000",
    "#0a0f14", "#1a0033", "#7a5cff", "#ff0000", "#00ff00", "#808080", "#40a8c4",
];

describe("the accent presets", () => {
    it("carry channels that match their hex", () => {
        for (const preset of ACCENT_PRESETS) {
            const expected = [1, 3, 5].map(offset => parseInt(preset.hex.slice(offset, offset + 2), 16));
            expect(parseChannels(preset.channels)).toEqual(expected);
        }
    });

    it("are their own ink on both ladders, so nothing about them moves", () => {
        for (const preset of ACCENT_PRESETS) {
            const accent = normalizeAccentColor(preset.id);
            expect(accent.inkOnDarkChannels).toBe(preset.channels);
            expect(accent.inkOnLightChannels).toBe(preset.channels);
        }
    });

    it("clear AA as text on the dark ladder's surface, which is what lets the clamp be AA there", () => {
        for (const preset of ACCENT_PRESETS) {
            expect(contrast(parseChannels(preset.channels), SURFACE.dark)).toBeGreaterThanOrEqual(AA_CONTRAST);
        }
    });
});

describe("the accent ink", () => {
    it("clears AA against the dark surface, whatever the accent", () => {
        for (const hex of SAMPLES) {
            const ink = parseChannels(accentInk(hex, "dark"));
            expect(contrast(ink, SURFACE.dark)).toBeGreaterThanOrEqual(AA_CONTRAST);
        }
    });

    /**
     * The light ladder's ceiling is the brand anchor rather than AA: the anchor's own 2.4:1 on a
     * light surface is a decision the design system records and holds (docs/design-system.md §1),
     * and tightening the ceiling past it would repaint all five presets. So the promise here is the
     * one the clamp can actually keep — no accent is ever less readable than the one that ships.
     */
    it("is never less readable than the brand anchor on the light surface", () => {
        const floor = contrast(ANCHOR, SURFACE.light);
        for (const hex of SAMPLES) {
            const ink = parseChannels(accentInk(hex, "light"));
            expect(contrast(ink, SURFACE.light)).toBeGreaterThanOrEqual(floor - 1e-9);
        }
    });

    it("rescues a pale accent on the light ladder and leaves it alone on the dark one", () => {
        const pale = normalizeAccentColor("#f3f0a0");
        expect(pale.inkOnDarkChannels).toBe(pale.channels);
        expect(pale.inkOnLightChannels).not.toBe(pale.channels);
        expect(contrast(parseChannels(pale.inkOnLightChannels), SURFACE.light))
            .toBeGreaterThan(contrast(parseChannels(pale.channels), SURFACE.light));
    });

    it("rescues a near-black accent on the dark ladder and leaves it alone on the light one", () => {
        const dim = normalizeAccentColor("#101010");
        expect(dim.inkOnLightChannels).toBe(dim.channels);
        expect(dim.inkOnDarkChannels).not.toBe(dim.channels);
    });

    /**
     * Mixing every channel toward one endpoint scales the gaps between them by the same factor, so
     * the ordering and the ratios that make a hue survive. The accent stays the user's colour.
     */
    it("keeps the hue it was given", () => {
        for (const hex of ["#f3f0a0", "#1a0033", "#7a5cff"]) {
            for (const ladder of ["dark", "light"] as const) {
                const source = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
                const ink = parseChannels(accentInk(hex, ladder));
                const order = (channels: readonly number[]): number[] =>
                    [0, 1, 2].sort((a, b) => channels[b] - channels[a]);
                expect(order(ink)).toEqual(order(source));
            }
        }
    });

    it("falls back to the default accent for a value it cannot read", () => {
        const fallback = normalizeAccentColor("not a colour");
        expect(fallback.inkOnDarkChannels).toBe(ACCENT_PRESETS[0].channels);
        expect(fallback.inkOnLightChannels).toBe(ACCENT_PRESETS[0].channels);
    });
});

describe("the ink's wiring", () => {
    it("is declared once per ladder and chosen by the theme", () => {
        expect(STYLES).toContain("--nl-primary-ink-on-dark: var(--nl-primary);");
        expect(STYLES).toContain("--nl-primary-ink-on-light: var(--nl-primary);");
        expect(STYLES).toContain("--nl-primary-ink: var(--nl-primary-ink-on-dark);");
        expect(STYLES).toContain("--nl-primary-ink: var(--nl-primary-ink-on-light);");
    });

    /**
     * The one change the 187 `text-primary` sites and the 181 `border-primary` sites follow. Read
     * through Tailwind's own resolver rather than by matching the config's text, because what
     * decides this is how `extend` merges: `textColor` and `borderColor` start life as a copy of
     * `colors`, and an entry under either of them has to win over the `colors.primary` beside it.
     */
    it("redirects the foreground utilities and only those", () => {
        const require = createRequire(import.meta.url);
        const resolveConfig = require("tailwindcss/resolveConfig") as (config: unknown) => {
            theme: Record<string, Record<string, string>>;
        };
        const theme = resolveConfig(require(join(REPO_ROOT, "tailwind.config.js"))).theme;

        for (const scale of ["textColor", "borderColor", "divideColor", "textDecorationColor"]) {
            expect(theme[scale].primary).toBe("rgb(var(--nl-primary-ink) / <alpha-value>)");
        }
        for (const scale of ["backgroundColor", "ringColor", "outlineColor", "fill", "stroke", "accentColor"]) {
            expect(theme[scale].primary).toBe("rgb(var(--nl-primary) / <alpha-value>)");
        }
    });
});
