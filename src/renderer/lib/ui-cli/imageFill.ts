/**
 * A container or button whose fill is set to an image, with no image to fill it.
 *
 * The inspector cannot make one - choosing "image" there opens the picker - but a write can: an
 * agent's `fillType: "image"` without an `imageFill`, or an `imageFill` whose asset was taken away.
 * The widget then paints no picture at all, and what shows is whatever its other rows leave behind -
 * typically the white a new container starts with, laid over everything under it - with nothing said
 * anywhere. The checks that write the page (`ui_apply`, `ui_patch`, `ui check`) name it instead.
 *
 * Read the way the page draws it at rest: the flat props, overlaid by the unconditional rows of the
 * appearance's default variant, which is where a widget made in Studio keeps its fill. A value
 * binding on the asset hands the picture over at runtime, and is not reported. A blueprint that sets
 * the picture cannot be seen from here; the hint says so.
 *
 * Pure and free of the widget registry, so the command line and the agent tools share it.
 *
 * Comments in English per project convention.
 */

import type { UIElement } from "@shared/types/ui-editor/document";

/** The widgets whose fill is a choice of colour, gradient or image. */
const IMAGE_FILL_WIDGETS = new Set(["nl.container", "nl.button"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value a key is drawn with at rest: the default variant's unconditional row, else the flat prop. */
function restingValue(props: Record<string, unknown>, key: string): unknown {
    const appearance = props.appearance;
    if (isRecord(appearance) && Array.isArray(appearance.variants)) {
        const variants = appearance.variants.filter(isRecord);
        const variant = variants.find(item => item.id === appearance.defaultVariantId) ?? variants[0];
        const groups = variant && Array.isArray(variant.propertyGroups) ? variant.propertyGroups.filter(isRecord) : [];
        const group = groups.find(item => item.key === key);
        const rows = group && Array.isArray(group.rows) ? group.rows.filter(isRecord) : [];
        const row = [...rows].reverse().find(item => item.conditions === null || item.conditions === undefined);
        if (row && "value" in row) {
            return row.value;
        }
    }
    return props[key];
}

/** Why `element` draws no picture although its fill says image, or null when it has one (or is not such a widget). */
export function emptyImageFillWarning(element: UIElement): string | null {
    if (!IMAGE_FILL_WIDGETS.has(element.type)) {
        return null;
    }
    const props = (element.props ?? {}) as Record<string, unknown>;
    if (restingValue(props, "fillType") !== "image" || restingValue(props, "fillVisible") === false) {
        return null;
    }
    if (element.valueBindings?.["imageFill.assetId"]) {
        return null;
    }
    const fill = restingValue(props, "imageFill");
    const assetId = isRecord(fill) && typeof fill.assetId === "string" ? fill.assetId.trim() : "";
    const legacy = restingValue(props, "backgroundImage");
    if (assetId || (typeof legacy === "string" && legacy.trim())) {
        return null;
    }
    return isRecord(fill)
        ? "its fill is an image (fillType \"image\") but its imageFill names no asset, so no picture is drawn and its box shows what its other fill rows leave (often a white fill over what is behind it)"
        : "its fill is an image (fillType \"image\") but it has no imageFill, so no picture is drawn and its box shows what its other fill rows leave (often a white fill over what is behind it)";
}

/** The hint that goes with {@link emptyImageFillWarning}. */
export const EMPTY_IMAGE_FILL_HINT =
    "Give it a picture - `imageFill = {\"mode\": \"cover\", \"assetId\": \"<asset id>\"}` - or set fillType back to \"color\" (fillVisible false for none). A blueprint that sets the picture when the page opens is fine; then ignore this.";
