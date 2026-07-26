/**
 * The separable Photoshop blend modes, as per-channel functions on 0..1 backdrop/source pairs.
 *
 * Only the separable ones: hue, saturation, colour and luminosity mix channels together, and getting
 * them subtly wrong would be worse than refusing them. A layer in one of those modes can be skipped
 * but not merged, and the wizard says so rather than pretending.
 */
export type BlendFunction = (backdrop: number, source: number) => number;

const clamp = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

const SEPARABLE: Record<string, BlendFunction> = {
    normal: (_backdrop, source) => source,
    multiply: (backdrop, source) => backdrop * source,
    screen: (backdrop, source) => backdrop + source - backdrop * source,
    darken: (backdrop, source) => Math.min(backdrop, source),
    lighten: (backdrop, source) => Math.max(backdrop, source),
    linearBurn: (backdrop, source) => clamp(backdrop + source - 1),
    linearDodge: (backdrop, source) => clamp(backdrop + source),
    colorBurn: (backdrop, source) => (source <= 0 ? 0 : 1 - Math.min(1, (1 - backdrop) / source)),
    colorDodge: (backdrop, source) => (source >= 1 ? 1 : Math.min(1, backdrop / (1 - source))),
    overlay: (backdrop, source) => (backdrop <= 0.5
        ? 2 * backdrop * source
        : 1 - 2 * (1 - backdrop) * (1 - source)),
    hardLight: (backdrop, source) => (source <= 0.5
        ? 2 * backdrop * source
        : 1 - 2 * (1 - backdrop) * (1 - source)),
    softLight: (backdrop, source) => (source <= 0.5
        ? backdrop - (1 - 2 * source) * backdrop * (1 - backdrop)
        : backdrop + (2 * source - 1) * ((backdrop <= 0.25
            ? ((16 * backdrop - 12) * backdrop + 4) * backdrop
            : Math.sqrt(backdrop)) - backdrop)),
    difference: (backdrop, source) => Math.abs(backdrop - source),
    exclusion: (backdrop, source) => backdrop + source - 2 * backdrop * source,
};

/** The blend function for a mode, or null when Studio will not merge it. */
export function separableBlend(mode: string): BlendFunction | null {
    return SEPARABLE[mode] ?? null;
}

export function canMerge(mode: string): boolean {
    return separableBlend(mode) !== null;
}

/**
 * Composite `source` over `backdrop` in place, both premultiplied-free RGBA at the same size.
 *
 * Straight Porter-Duff "over" with the blend applied to the colour term, which is what Photoshop
 * shows for a separable mode at full fill.
 */
export function blendOver(backdrop: Uint8Array, source: Uint8Array, mode: string): void {
    const blend = separableBlend(mode) ?? SEPARABLE.normal;
    for (let i = 0; i < backdrop.length; i += 4) {
        const sourceAlpha = source[i + 3] / 255;
        if (sourceAlpha === 0) {
            continue;
        }
        const backdropAlpha = backdrop[i + 3] / 255;
        const outAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
        for (let channel = 0; channel < 3; channel++) {
            const b = backdrop[i + channel] / 255;
            const s = source[i + channel] / 255;
            // Where the backdrop is transparent there is nothing to blend with, so the source shows
            // through unblended - otherwise a multiply layer over empty canvas would come out black.
            const blended = backdropAlpha === 0 ? s : blend(b, s);
            const mixed = (1 - backdropAlpha) * s + backdropAlpha * blended;
            const out = (sourceAlpha * mixed + backdropAlpha * b * (1 - sourceAlpha)) / (outAlpha || 1);
            backdrop[i + channel] = Math.round(clamp(out) * 255);
        }
        backdrop[i + 3] = Math.round(outAlpha * 255);
    }
}
