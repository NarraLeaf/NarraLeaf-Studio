export type FilterPresetId = "brightness" | "contrast" | "saturate" | "grayscale";

const SINGLE_PRESET_RE = /^\s*(brightness|contrast|saturate|grayscale)\(\s*([-+]?[\d.]+)\s*\)\s*$/i;

export type ParsedSimpleFilter =
    | { kind: "preset"; preset: FilterPresetId; amount: number }
    | { kind: "custom"; raw: string };

export function parseSimpleFilter(raw: string): ParsedSimpleFilter {
    const t = raw.trim();
    if (!t) {
        return { kind: "preset", preset: "brightness", amount: 1 };
    }
    const m = t.match(SINGLE_PRESET_RE);
    if (!m) {
        return { kind: "custom", raw: t };
    }
    const preset = m[1]!.toLowerCase() as FilterPresetId;
    const amount = Number(m[2]);
    if (!Number.isFinite(amount)) {
        return { kind: "custom", raw: t };
    }
    return { kind: "preset", preset, amount };
}

export function serializeSimpleFilter(preset: FilterPresetId, amount: number): string {
    switch (preset) {
        case "brightness":
            return `brightness(${amount})`;
        case "contrast":
            return `contrast(${amount})`;
        case "saturate":
            return `saturate(${amount})`;
        case "grayscale":
            return `grayscale(${amount})`;
        default:
            return `brightness(${amount})`;
    }
}

export const FILTER_PRESET_OPTIONS: { value: FilterPresetId; label: string }[] = [
    { value: "brightness", label: "Brightness" },
    { value: "contrast", label: "Contrast" },
    { value: "saturate", label: "Saturate" },
    { value: "grayscale", label: "Grayscale" },
];

export const FILTER_PRESET_NEUTRAL: Record<FilterPresetId, number> = {
    brightness: 1,
    contrast: 1,
    saturate: 1,
    grayscale: 0,
};
