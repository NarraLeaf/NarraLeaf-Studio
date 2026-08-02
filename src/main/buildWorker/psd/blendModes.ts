/**
 * The Photoshop blend modes Studio can flatten into pixels.
 *
 * Two families. The separable ones are per-channel functions; the rest — hue, saturation, colour,
 * luminosity and the two whole-pixel "darker/lighter colour" modes — mix channels together and have
 * to see the whole triple. Both come from the W3C compositing spec, which is what Photoshop
 * implements, so they are transcribed rather than approximated.
 */
export type BlendFunction = (backdrop: number, source: number) => number;

/** A blend that needs all three channels at once. Operates on 0..1 triples. */
export type NonSeparableBlend = (backdrop: RGB, source: RGB) => RGB;

type RGB = [number, number, number];

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

// --- the non-separable family, transcribed from the W3C compositing spec ---------------------

/** Perceived brightness. The coefficients are the spec's, and Photoshop's. */
const lum = (c: RGB): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

/** Pull a colour back inside the cube without changing its luminosity. */
function clipColor(c: RGB): RGB {
    const l = lum(c);
    const min = Math.min(c[0], c[1], c[2]);
    const max = Math.max(c[0], c[1], c[2]);
    let out = c;
    if (min < 0) {
        out = out.map(v => l + ((v - l) * l) / (l - min)) as RGB;
    }
    if (max > 1) {
        out = out.map(v => l + ((v - l) * (1 - l)) / (max - l)) as RGB;
    }
    return out;
}

function setLum(c: RGB, l: number): RGB {
    const d = l - lum(c);
    return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

const sat = (c: RGB): number => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

/** Rescale a colour to a given saturation, keeping which channel is min/mid/max. */
function setSat(c: RGB, s: number): RGB {
    const order = [0, 1, 2].sort((a, b) => c[a] - c[b]);
    const [min, mid, max] = order;
    const out: RGB = [0, 0, 0];
    if (c[max] > c[min]) {
        out[mid] = ((c[mid] - c[min]) * s) / (c[max] - c[min]);
        out[max] = s;
    }
    out[min] = 0;
    return out;
}

const NON_SEPARABLE: Record<string, NonSeparableBlend> = {
    hue: (backdrop, source) => setLum(setSat(source, sat(backdrop)), lum(backdrop)),
    saturation: (backdrop, source) => setLum(setSat(backdrop, sat(source)), lum(backdrop)),
    color: (backdrop, source) => setLum(source, lum(backdrop)),
    luminosity: (backdrop, source) => setLum(backdrop, lum(source)),
    // Photoshop's own two: pick the whole pixel, not channel by channel.
    darkerColor: (backdrop, source) => (lum(source) < lum(backdrop) ? source : backdrop),
    lighterColor: (backdrop, source) => (lum(source) > lum(backdrop) ? source : backdrop),
};

/** The blend function for a separable mode, or null. */
export function separableBlend(mode: string): BlendFunction | null {
    return SEPARABLE[mode] ?? null;
}

export function nonSeparableBlend(mode: string): NonSeparableBlend | null {
    return NON_SEPARABLE[mode] ?? null;
}

/**
 * Whether Studio can flatten this mode at all.
 *
 * `dissolve` is the notable refusal: it is stochastic, and Photoshop's dither pattern is not
 * documented, so any version of it would be a different picture every time.
 */
export function canMerge(mode: string): boolean {
    return separableBlend(mode) !== null || nonSeparableBlend(mode) !== null;
}

/**
 * Composite `source` over `backdrop` in place, both premultiplied-free RGBA at the same size.
 *
 * Straight Porter-Duff "over" with the blend applied to the colour term, which is what Photoshop
 * shows for a separable mode at full fill.
 */
export function blendOver(backdrop: Uint8Array, source: Uint8Array, mode: string): void {
    const separable = separableBlend(mode);
    const nonSeparable = separable ? null : nonSeparableBlend(mode);
    const blend = separable ?? SEPARABLE.normal;
    const b: RGB = [0, 0, 0];
    const s: RGB = [0, 0, 0];
    for (let i = 0; i < backdrop.length; i += 4) {
        const sourceAlpha = source[i + 3] / 255;
        if (sourceAlpha === 0) {
            continue;
        }
        const backdropAlpha = backdrop[i + 3] / 255;
        const outAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
        for (let channel = 0; channel < 3; channel++) {
            b[channel] = backdrop[i + channel] / 255;
            s[channel] = source[i + channel] / 255;
        }
        // Where the backdrop is transparent there is nothing to blend with, so the source shows
        // through unblended - otherwise a multiply layer over empty canvas would come out black.
        const blended: RGB = backdropAlpha === 0
            ? [s[0], s[1], s[2]]
            : nonSeparable
                ? nonSeparable(b, s)
                : [blend(b[0], s[0]), blend(b[1], s[1]), blend(b[2], s[2])];
        for (let channel = 0; channel < 3; channel++) {
            const mixed = (1 - backdropAlpha) * s[channel] + backdropAlpha * blended[channel];
            const out = (sourceAlpha * mixed + backdropAlpha * b[channel] * (1 - sourceAlpha)) / (outAlpha || 1);
            backdrop[i + channel] = Math.round(clamp(out) * 255);
        }
        backdrop[i + 3] = Math.round(outAlpha * 255);
    }
}
