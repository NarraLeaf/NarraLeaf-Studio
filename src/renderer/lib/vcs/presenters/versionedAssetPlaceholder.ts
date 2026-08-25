import type { AssetBytesResult, AssetBytesSource } from "@/lib/ui-editor/assets/assetBytesSource";

/**
 * What a widget shows when its picture cannot honestly be drawn from the version on screen.
 *
 * The comparison draws a page as it stood at some earlier version, and every image, video and font
 * inside it has to come from that version too. When one cannot - the asset had no record then, or
 * the read broke - the one thing that may NOT happen is the live ladder's answer appearing in its
 * place, which is today's file under yesterday's layout with nothing on screen saying so.
 *
 * Leaving the element blank is not the answer either. A widget with no fill is a perfectly ordinary
 * thing for an author to have made, so an empty box says "there is no image here" - a statement
 * about the page - where the true statement is about the comparison: "the image cannot honestly be
 * shown here". Those are different facts and an author acts on them differently.
 *
 * So a refusal is drawn, in place, as a picture of its own.
 *
 * ## Why it is bytes rather than a component
 *
 * The mark has to land inside the widget, at the widget's size, behind whatever the widget draws on
 * top - and the code that decides all three is the widget renderer, which lives in
 * `@/lib/ui-editor` and is compiled into every shipped game. Teaching those renderers about version
 * control would put a comparison concern inside the runtime bundle, which is the boundary this
 * repository keeps re-discovering. Handing back an image instead needs no renderer to know anything:
 * it arrives through the same seam real bytes do, and every element that can show a picture shows
 * this one exactly where it would have shown that one.
 *
 * ## Why the two look different
 *
 * `absent` is a fact about the version - an asset imported last week is genuinely not in last
 * month's tree, and nothing is wrong. `failed` is a fault, and an author who cannot tell them apart
 * either chases a fault that does not exist or ignores one that does. Neither carries words: it is
 * drawn at whatever size the widget is, which on a page scaled into half a comparison pane is
 * routinely twenty pixels across, and text there is a smear. The words are in the line under the
 * canvas, where there is room for them and where they can be translated.
 *
 * The colours are literals, unlike everything else on this surface. A blob has no stylesheet behind
 * it, so a design-system token cannot reach it; both are picked to read on a light and a dark page.
 */

/** A neutral that stays visible on a white page and on a black one. */
const NEUTRAL = "#8a8f98";

/** The warning hue, for the refusal that is a fault. */
const FAULT = "#c2830b";

/**
 * `preserveAspectRatio="none"` so the mark fills whatever box it is given.
 *
 * A widget's fill is drawn with `object-fit` or as a background, and an SVG with an aspect ratio
 * would be letterboxed inside it - leaving part of the box empty, which is the one reading this
 * mark exists to prevent.
 */
function placeholderSvg(stroke: string, dashed: boolean, marks: readonly string[]): string {
    const dash = dashed ? ` stroke-dasharray="7 5"` : "";
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" preserveAspectRatio="none">`,
        `<rect x="1.5" y="1.5" width="61" height="61" fill="${stroke}" fill-opacity="0.1"`,
        ` stroke="${stroke}" stroke-opacity="0.6" stroke-width="3"${dash}/>`,
        ...marks.map(d => `<path d="${d}" stroke="${stroke}" stroke-opacity="0.6" stroke-width="3" fill="none"/>`),
        `</svg>`,
    ].join("");
}

/** One diagonal: a mark, not a cancellation. */
const ABSENT_SVG = placeholderSvg(NEUTRAL, true, ["M6 58 L58 6"]);

/** Two diagonals, solid: the shape every interface uses for something that went wrong. */
const FAILED_SVG = placeholderSvg(FAULT, false, ["M6 58 L58 6", "M6 6 L58 58"]);

function svgBytes(svg: string): AssetBytesResult {
    return {
        kind: "bytes",
        bytes: new TextEncoder().encode(svg),
        mediaType: "image/svg+xml",
    };
}

/**
 * The mark for one kind of refusal, built once.
 *
 * Built once because a page of a comparison can ask for it thirty times, and the answer is the same
 * thirty bytes each time. The hook that receives it mints its own object URL per call and revokes
 * it, so sharing the array costs nothing and is never mutated.
 */
const PLACEHOLDERS: Readonly<Record<"absent" | "failed", AssetBytesResult>> = Object.freeze({
    absent: svgBytes(ABSENT_SVG),
    failed: svgBytes(FAILED_SVG),
});

export function assetRefusalPlaceholder(kind: "absent" | "failed"): AssetBytesResult {
    return PLACEHOLDERS[kind];
}

/** True for the bytes {@link assetRefusalPlaceholder} hands back, so a test can tell them apart. */
export function isAssetRefusalPlaceholder(result: AssetBytesResult): boolean {
    return result === PLACEHOLDERS.absent || result === PLACEHOLDERS.failed;
}

/**
 * The same source, with every refusal drawn instead of left blank.
 *
 * A separate wrapper rather than a branch inside the source, so that the source stays honest: it
 * answers `absent` and `failed` as themselves, which is what its tests read and what the line under
 * the canvas counts. Substituting a picture is a decision about what to SHOW, and it is made here,
 * once, on the value that is actually mounted.
 */
export function drawRefusalsAsPlaceholders(source: AssetBytesSource): AssetBytesSource {
    return {
        id: source.id,
        read: async (assetId, pool) => {
            const result = await source.read(assetId, pool);
            return result.kind === "bytes" ? result : assetRefusalPlaceholder(result.kind);
        },
    };
}
