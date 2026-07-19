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
 * pick anything; see `accentForeground` for what makes that safe.
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

function hexToChannels(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r} ${g} ${b}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
    const channels = [1, 3, 5].map(offset => {
        const srgb = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
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
 */
export function accentForeground(hex: string): string {
    // The light theme's `--nl-fg`, so dark ink on the accent matches ink everywhere else.
    return relativeLuminance(hex) > 0.5 ? "27 33 41" : "255 255 255";
}

export interface AccentColor {
    /** Preset id, or `ACCENT_CUSTOM_ID` for a hex the user picked. */
    id: string;
    hex: string;
    /** `--nl-primary` channels. */
    channels: string;
    /** `--nl-on-primary` channels. */
    foregroundChannels: string;
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
        };
    }

    const hex = normalizeHexColor(value);
    if (hex) {
        return {
            id: ACCENT_CUSTOM_ID,
            hex,
            channels: hexToChannels(hex),
            foregroundChannels: accentForeground(hex),
        };
    }

    return normalizeAccentColor(ACCENT_COLOR_DEFAULT);
}

/** Preset id → swatch hex, for the Settings window's color chips. */
export const ACCENT_SWATCHES: Record<string, string> = Object.fromEntries(
    ACCENT_PRESETS.map(preset => [preset.id, preset.hex]),
);
