/**
 * Studio accent color, stored under the `ui.accentColor` global-state key and applied by the
 * renderer (see src/renderer/lib/appearance) by overriding the `--nl-primary` channels on the
 * document root.
 *
 * The stored value is either a PRESET ID or a `#rrggbb` hex. The presets are the guided path —
 * `#40a8c4` is the brand anchor and each alternative is the same recipe at a different hue
 * (saturation 14–53%, lightness 51–62%, see docs/design-system.md), with the hues that would
 * collide with a semantic color deliberately absent: green (`success`), amber (`warning`), coral
 * (`danger`) and the violet the blueprint editor uses for `binding`. Beyond them the user can
 * pick anything; `accentForeground` and `accentInk` are what make that safe — one for the ink
 * written ON the accent, the other for the accent written on an ordinary surface.
 *
 * Shared rather than renderer-local because the value is part of the global state contract.
 */

export interface AccentPreset {
    /** Stored under `ui.accentColor`. */
    id: string;
    /** Swatch color, and the value `--nl-primary` resolves to. */
    hex: string;
    /** Space-separated RGB channels, the form `--nl-primary` is written in. */
    channels: string;
    /** English name; the Settings window shows the translated one. */
    label: string;
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
    // The brand anchor. H193 S53 L51 — fixed, and the default.
    { id: "teal", hex: "#40a8c4", channels: "64 168 196", label: "Leaf teal" },
    // H206 S50 L55 — the anchor rotated toward blue.
    { id: "sky", hex: "#5394c6", channels: "83 148 198", label: "Sky" },
    // H228 S45 L62 — further round, lightened to hold its own on dark surfaces.
    { id: "indigo", hex: "#7384ca", channels: "115 132 202", label: "Indigo" },
    // H328 S42 L60 — the one warm option, kept 40° off `danger` so a primary
    // button never reads as a destructive one.
    { id: "rose", hex: "#c46e9c", channels: "196 110 156", label: "Rose" },
    // H210 S14 L52 — the anchor with the color drained out, for interfaces that
    // should recede entirely.
    { id: "slate", hex: "#738596", channels: "115 133 150", label: "Slate" },
];

export const ACCENT_COLOR_DEFAULT = "teal";

/** The id a custom hex resolves to; never stored, only reported by `normalizeAccentColor`. */
export const ACCENT_CUSTOM_ID = "custom";

const PRESETS_BY_ID = new Map(ACCENT_PRESETS.map(preset => [preset.id, preset]));

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Expand `#abc` and bare `abc123` to a canonical lowercase `#aabbcc`. */
export function normalizeHexColor(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const match = HEX_PATTERN.exec(value.trim());
    if (!match) {
        return null;
    }
    const digits = match[1].toLowerCase();
    const full = digits.length === 3 ? digits.replace(/./g, digit => digit + digit) : digits;
    return `#${full}`;
}

function hexChannels(hex: string): number[] {
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function hexToChannels(hex: string): string {
    return hexChannels(hex).join(" ");
}

/** WCAG relative luminance of RGB channels, 0 (black) to 1 (white). */
function channelLuminance(channels: readonly number[]): number {
    const linear = channels.map(value => {
        const srgb = value / 255;
        return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
    return channelLuminance(hexChannels(hex));
}

/**
 * Ink to put ON the accent — what `--nl-on-primary` and the `on-primary` Tailwind color resolve
 * to. Without it "any color" would be only nominally true: the product paints white on the accent
 * (primary buttons, badges), and a pale yellow accent would render those unreadable.
 *
 * The threshold is 0.5, not the ~0.18 where black overtakes white on pure contrast. Every preset
 * — the anchor included — sits below 0.5 and keeps its white text, because white-on-accent is the
 * product's look and "optimize contrast" would have flipped the default brand button to black
 * text. This is a rescue for genuinely light colors, not a contrast optimizer.
 *
 * The mirror image — the accent written on a surface rather than under one — is `accentInk`.
 */
export function accentForeground(hex: string): string {
    // The light theme's `--nl-fg`, so dark ink on the accent matches ink everywhere else.
    return relativeLuminance(hex) > 0.5 ? "27 33 41" : "255 255 255";
}

/**
 * The neutral surface each ladder is measured against: `--nl-surface` in styles.css, the app and
 * panel background almost all accent text is read on. Repeated here because the clamp below runs
 * before anything is painted and has no computed style to read; `accent.test.ts` parses the
 * stylesheet and fails if the two ever drift.
 */
const SURFACE_ON_DARK = "#0f1115";
const SURFACE_ON_LIGHT = "#eef0f4";

/** WCAG AA for body text. */
const AA_CONTRAST = 4.5;

/** Lowest luminance that still clears AA as the LIGHTER half of a pair with `surface`. */
function aaFloorAgainst(surface: string): number {
    return AA_CONTRAST * (relativeLuminance(surface) + 0.05) - 0.05;
}

/** Highest luminance that still clears AA as the DARKER half of a pair with `surface`. */
function aaCeilingAgainst(surface: string): number {
    return (relativeLuminance(surface) + 0.05) / AA_CONTRAST - 0.05;
}

/**
 * The band the ink is kept inside: AA against the surface, on both ladders and for every accent.
 * Text that carries meaning has to be readable, and there is no accent for which that stops being
 * true, so there is no second clause here — nothing is exempt, presets included.
 *
 * The two ladders reach that differently, and only one of them moves any pixels:
 *
 *   - dark: AA needs 0.200 and the darkest preset sits at 0.226, so all five are already inside
 *     and come out untouched. Only a dark custom accent is lifted.
 *   - light: AA needs 0.155 while the presets sit between 0.226 and 0.331, so all five are pushed
 *     down — the brand anchor `#40a8c4` is written as `#2d768a` when it is a glyph or a hairline
 *     on a pale surface. That is the point rather than a side effect: the anchor's own 2.4:1 there
 *     was unreadable, and the ceiling used to be pinned to it so that the presets stayed
 *     pixel-identical, which bought identical pixels at the cost of the text.
 *
 * The accent itself is untouched by any of this. Filled shapes (`bg-primary`), focus rings and SVG
 * fill/stroke still paint the raw `--nl-primary`, so the anchor is still the anchor everywhere it
 * is being looked at rather than read.
 */
const INK_FLOOR_ON_DARK = aaFloorAgainst(SURFACE_ON_DARK);
const INK_CEILING_ON_LIGHT = aaCeilingAgainst(SURFACE_ON_LIGHT);

/** Granularity of the mix below: 1/1024 of the way to black or white per step. */
const MIX_STEPS = 1024;

/** `channels` with `steps / MIX_STEPS` of `toward` (black or white) mixed in. */
function mixToward(channels: readonly number[], toward: number, steps: number): number[] {
    const amount = steps / MIX_STEPS;
    return channels.map(value => Math.round(value + (toward - value) * amount));
}

/**
 * The colour moved along the black-to-white axis until it is inside the band, and not one step
 * further.
 *
 * That axis rather than a lightness ramp because mixing every channel toward the same endpoint
 * scales the differences between them uniformly, which leaves the hue exactly where the user put
 * it - the accent is still recognisably their colour, only readable.
 */
function clampLuminance(channels: readonly number[], bound: number, lighten: boolean): number[] {
    const inside = (candidate: readonly number[]): boolean =>
        lighten ? channelLuminance(candidate) >= bound : channelLuminance(candidate) <= bound;
    if (inside(channels)) {
        return [...channels];
    }
    // Mixing white in only raises luminance and mixing black in only lowers it - rounding to whole
    // channels included - so the least amount that reaches the bound is a binary search. Searching
    // whole steps means the rounded channels the search settles on are the ones published, with no
    // second rounding afterwards that could fall back out of the band.
    const toward = lighten ? 255 : 0;
    let low = 0;
    let high = MIX_STEPS;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (inside(mixToward(channels, toward, mid))) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    return mixToward(channels, toward, low);
}

/**
 * Ink for the accent used as a FOREGROUND on a neutral surface — what `--nl-primary-ink` and the
 * `text-primary` / `border-primary` / `decoration-primary` utilities resolve to.
 *
 * `--nl-on-primary` only answers what to write ON the accent. The accent is also written IN, on
 * ordinary surfaces, at close to two hundred places, and there "any colour" is only honest if a
 * pale one still reads: an accent whose luminance is next to the surface's draws a glyph nobody
 * can see. So the ink is the accent with its luminance clamped to AA against the surface of the
 * ladder it will be read on — lifted on the dark one, lowered on the light one, and returned
 * untouched whenever it was already inside. The presets are inside on the dark ladder and outside
 * on the light one, so the five come back unchanged there and darkened here.
 *
 * Two ladders and no way to ask which is current: the theme is `prefers-color-scheme` and Electron
 * updates that query's value without dispatching `change` (docs/design-system.md §0). Both inks are
 * therefore published and the stylesheet picks.
 */
export function accentInk(hex: string, ladder: "dark" | "light"): string {
    const channels = hexChannels(hex);
    const clamped = ladder === "dark"
        ? clampLuminance(channels, INK_FLOOR_ON_DARK, true)
        : clampLuminance(channels, INK_CEILING_ON_LIGHT, false);
    return clamped.join(" ");
}

export interface AccentColor {
    /** Preset id, or `ACCENT_CUSTOM_ID` for a hex the user picked. */
    id: string;
    hex: string;
    /** `--nl-primary` channels. */
    channels: string;
    /** `--nl-on-primary` channels. */
    foregroundChannels: string;
    /** `--nl-primary-ink-on-dark` channels. */
    inkOnDarkChannels: string;
    /** `--nl-primary-ink-on-light` channels. */
    inkOnLightChannels: string;
}

/** Resolve a stored value — a preset id, a hex, or something stale — to a usable accent. */
export function normalizeAccentColor(value: unknown): AccentColor {
    const preset = typeof value === "string" ? PRESETS_BY_ID.get(value) : undefined;
    if (preset) {
        return {
            id: preset.id,
            hex: preset.hex,
            channels: preset.channels,
            foregroundChannels: accentForeground(preset.hex),
            inkOnDarkChannels: accentInk(preset.hex, "dark"),
            inkOnLightChannels: accentInk(preset.hex, "light"),
        };
    }

    const hex = normalizeHexColor(value);
    if (hex) {
        return {
            id: ACCENT_CUSTOM_ID,
            hex,
            channels: hexToChannels(hex),
            foregroundChannels: accentForeground(hex),
            inkOnDarkChannels: accentInk(hex, "dark"),
            inkOnLightChannels: accentInk(hex, "light"),
        };
    }

    return normalizeAccentColor(ACCENT_COLOR_DEFAULT);
}

/** Preset id → swatch hex, for the Settings window's color chips. */
export const ACCENT_SWATCHES: Record<string, string> = Object.fromEntries(
    ACCENT_PRESETS.map(preset => [preset.id, preset.hex]),
);
