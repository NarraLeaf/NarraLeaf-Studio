/**
 * The shape `nl.image` used to store its picture in, folded into the one it stores it in now.
 *
 * An image widget used to name its asset in a top-level `assetId`, with `objectFit` for how to fit
 * it, `imageUrl` for a raw address and `imageOpacity` for its transparency. It names all four
 * through `fillType` / `imageFill` / `backgroundImage` / `fillOpacity` now, the same way every other
 * rectangle-shaped widget does.
 *
 * Both readings were being kept alive at render time, which is the arrangement this replaces. Two
 * reasons it could not stay:
 *
 *  - **A stale `assetId` is a live asset reference.** `forEachUiAssetIdSlot` finds asset ids by
 *    property name at any depth, and the shipped game's preloader walks the same names - so an
 *    element whose picture was changed (writing `imageFill` and leaving `assetId` untouched, which
 *    is what the writer does) keeps the *previous* file referenced. It is resolved into the package,
 *    survives asset trimming, and is fetched at startup by a game that never draws it.
 *  - **The render-time reading could never converge.** Nothing rewrote the element, so every project
 *    carried the old shape forever and the translation had to run on every read, in code the game
 *    runtime bundles.
 *
 * So the fold happens once, on load, and what it writes is what everything downstream already reads.
 *
 * Deliberately keyed on `nl.image` alone by its caller. `assetId` is a property name other widgets
 * may use for something of their own, and this is a translation of one widget's history rather than
 * a rule about the name.
 */

import type { ImageFill } from "./imageFill";

/** The one widget type this translates. See the note above about not keying on the property name. */
export const UI_IMAGE_ELEMENT_TYPE = "nl.image";

/** The four keys the old shape used. All are dropped once the fold has read them. */
const LEGACY_KEYS = ["assetId", "imageUrl", "objectFit", "imageOpacity"] as const;

/**
 * `objectFit` in the CSS sense, as a fill mode.
 *
 * Not {@link mapLegacyFitToMode}, which reads `backgroundFit` and falls back to `stretch`. This one
 * falls back to `cover`, because that is what the render-time reading answered and an image whose
 * fit changed on load would be a picture that moved for no reason the author can see.
 */
function objectFitToMode(fit: unknown): ImageFill["mode"] {
    if (fit === "fill") return "stretch";
    if (fit === "contain") return "contain";
    return "cover";
}

function trimmedString(value: unknown): string {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * The props of one `nl.image`, in the current shape - or `null` when they already were.
 *
 * The precedence is the render-time reading's, exactly: a picture already named in `imageFill` or
 * `backgroundImage` wins, and the old keys are then only dropped. Getting that wrong would repaint
 * elements an author had already moved to the current shape by hand.
 */
export function foldLegacyImageProps(
    props: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
    if (!props) {
        return null;
    }
    if (!LEGACY_KEYS.some(key => props[key] !== undefined)) {
        return null;
    }

    const next: Record<string, unknown> = { ...props };
    for (const key of LEGACY_KEYS) {
        delete next[key];
    }

    const storedFill = props.imageFill as ImageFill | undefined;
    const claimed = trimmedString(storedFill?.assetId) || trimmedString(props.backgroundImage);
    const legacyAssetId = trimmedString(props.assetId);
    const legacyUrl = trimmedString(props.imageUrl);

    if (!claimed && legacyAssetId) {
        next.fillType = "image";
        next.imageFill = {
            mode: objectFitToMode(props.objectFit),
            assetId: legacyAssetId,
            ...(storedFill?.cropPlacement ? { cropPlacement: storedFill.cropPlacement } : {}),
        } satisfies ImageFill;
    } else if (!claimed && legacyUrl) {
        next.fillType = "image";
        next.backgroundImage = legacyUrl;
    }

    const legacyOpacity = props.imageOpacity;
    if (props.fillOpacity === undefined && typeof legacyOpacity === "number" && Number.isFinite(legacyOpacity)) {
        next.fillOpacity = Math.max(0, Math.min(1, legacyOpacity));
    }

    return next;
}
