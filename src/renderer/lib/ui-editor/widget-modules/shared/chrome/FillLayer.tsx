import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import type { GradientFill } from "@shared/types/ui-editor/gradientFill";
import { gradientToCss, type ResolvedGradientStop } from "@shared/ui-editor/gradientCss";

/**
 * The widget fill, painted on a layer of its own rather than on the chrome root.
 *
 * **Why a layer at all.** A colour fill is `background-color` on the root and its transition is motion
 * interpolating that one value, which is the cheapest thing that could work and stays exactly as it
 * is. A gradient has no such path: motion cannot interpolate two gradients, which may differ in kind
 * and in stop count, so a change of fill is a crossfade of two elements instead. The layer is what
 * there are two of.
 *
 * **So the layer is mounted only when it is earning its place** - for a gradient, or while a
 * crossfade runs. Giving every rectangle in the editor a permanent extra node to paint a flat colour
 * that `background-color` already paints would be a cost with nothing on the other side of it.
 */

/** Presence is the contract: a gradient fill has this attribute, a plain colour fill does not. */
export const FILL_LAYER_ATTRIBUTE = "data-ui-fill-layer";

/**
 * The layer paints beneath every child, and a negative z-index is the only way an absolutely
 * positioned element does that.
 *
 * CSS paints positioned descendants (step 8 of the painting order) above in-flow, non-positioned
 * ones - block backgrounds, floats and inline content, steps 4 to 7 - whatever the DOM order. A
 * layer at `z-index: auto` would therefore cover a button's label and a text widget's text, since
 * both of those arrive as ordinary in-flow content. Only a negative z-index paints in step 3,
 * between the root's own background and its in-flow children, which is precisely where a fill
 * belongs.
 *
 * The price is that a negative z-index escapes any ancestor that is not a stacking context, so the
 * root must be one - see {@link FILL_LAYER_ROOT_STYLE}.
 */
export const FILL_LAYER_Z_INDEX = -1;

/**
 * What the chrome root needs while a fill layer is mounted.
 *
 * `isolation: isolate` makes the root a stacking context so {@link FILL_LAYER_Z_INDEX} stays inside
 * the widget instead of sliding behind whatever ancestor happens to be one. It is spelled this way
 * rather than leaning on the root's `transform` because motion writes `transform: none` when every
 * transform value is at its default, so the stacking context would come and go with the widget's
 * offset. `isolation` costs no compositing layer, and it is applied only while a layer is mounted so
 * that a widget with a plain colour fill keeps blending exactly as it does today.
 */
export const FILL_LAYER_ROOT_STYLE: CSSProperties = { isolation: "isolate" };

/**
 * A fill reduced to what painting it needs.
 *
 * `signature` deliberately excludes `fillOpacity` and `fillVisible`: those two are the layer's own
 * opacity and animate on the one layer (the image path animates the same pair), where a change of
 * `signature` is a change of *fill* and is what a crossfade is for.
 */
export type FillPaint = {
    /** A `background-image` value, for a gradient; `null` for a flat colour. */
    image: string | null;
    /** A `background-color` value, for a flat colour; `null` for a gradient. */
    color: string | null;
    /**
     * Nothing behind this paint can show through it - every colour in it is fully opaque. It is the
     * paint's own alpha only; the caller folds in `fillOpacity` and `fillVisible`, which it owns.
     */
    opaque: boolean;
    /** Two paints with the same signature paint the same pixels. */
    signature: string;
};

/** True for a gradient paint, which is the fill the root cannot paint by itself. */
export function fillPaintNeedsLayer(paint: FillPaint | null): boolean {
    return paint?.image != null;
}

/**
 * An already-parsed colour as a fill paint.
 *
 * It takes the `ColorValue` rather than the stored string because the caller has invariably parsed
 * that string already, and `parseColorValue` on an `nlbrand:` link is a palette lookup - paid once
 * per rectangle per render, on a canvas that re-renders the whole element tree on a surface switch.
 *
 * `fillOpacity` is not folded into the colour here, unlike the root's `background-color`, because the
 * layer carries it as its own opacity - baking it in would make every opacity change read as a change
 * of fill and start a crossfade against itself.
 */
export function resolveColorFillPaint(parsed: ColorValue): FillPaint {
    const alpha = parsed.alpha ?? 1;
    const color = colorValueToCss({ hex: parsed.hex, alpha });
    return { image: null, color, opaque: alpha >= 1, signature: `c:${color}` };
}

/**
 * A stored gradient as a fill paint.
 *
 * Each stop goes through the same `parseColorValue` / `colorValueToCss` pair as every other colour in
 * this file, so a stop may hold `nlbrand:<id>` like any other colour field and the shipped game -
 * which aliases that module to its own copy - resolves it the same way. Geometry is then
 * `gradientToCss`, shared with the runtime, so both hosts build the same string from the same numbers.
 *
 * **Nothing here may be memoised on props.** A palette edit moves neither props nor the document
 * version, so a cache keyed on them would freeze the gradient at yesterday's colours until the tab
 * was switched away and back. Building the string during render is what makes a palette edit visible.
 */
export function resolveGradientFillPaint(fill: GradientFill): FillPaint {
    const stops: ResolvedGradientStop[] = [];
    let opaque = true;
    for (const stop of fill.stops) {
        const parsed = parseColorValue(stop.color, { hex: "#FFFFFF", alpha: 1 });
        const alpha = parsed.alpha ?? 1;
        if (alpha < 1) {
            opaque = false;
        }
        stops.push({ offset: stop.offset, color: colorValueToCss({ hex: parsed.hex, alpha }) });
    }
    const image = gradientToCss(fill, stops);
    return { image, color: null, opaque, signature: `g:${image}` };
}

/** Where each half of a crossfade starts and ends. */
export type FillCrossfadePlan = {
    /** The outgoing layer's target opacity, from the opacity it is already painting at. */
    outgoingTo: number;
    /** The incoming layer's starting opacity. */
    incomingFrom: number;
};

/**
 * How the two layers move past each other.
 *
 * **An opaque incoming fill means the outgoing one does not move.** Fading both would put them at
 * 0.5 and 0.5 half way through, which composites to a combined alpha of 0.75 - so whatever sits
 * behind the widget shows through the middle of every transition as a visible dip. Holding the
 * outgoing layer and fading the incoming one over it keeps the pair opaque at every instant.
 *
 * A translucent incoming fill is the case where the old fill genuinely has to leave: if it stayed,
 * it would still be showing through the new one when the transition ended. So both animate, and the
 * dip is not a flaw but the honest reading of what was asked for.
 *
 * @param incomingOpaque whether the incoming fill covers the box completely, `fillOpacity` and
 *   `fillVisible` included.
 * @param outgoingOpacity the opacity the outgoing layer is painting at when the crossfade starts.
 */
export function planFillCrossfade(incomingOpaque: boolean, outgoingOpacity: number): FillCrossfadePlan {
    return {
        outgoingTo: incomingOpaque ? outgoingOpacity : 0,
        incomingFrom: 0,
    };
}

/** The four corner radii, resolved. The layer follows the chrome's corners, and animates with them. */
export type FillLayerRadii = {
    borderTopLeftRadius: number;
    borderTopRightRadius: number;
    borderBottomRightRadius: number;
    borderBottomLeftRadius: number;
};

export type FillLayerRole = "current" | "outgoing";

export type FillLayerProps = {
    paint: FillPaint;
    /** Where the layer ends up: `fillOpacity`, or 0 when the fill is hidden. */
    opacity: number;
    /** Where it starts. `null` mounts at `opacity` and animates nothing. */
    initialOpacity?: number | null;
    radii: FillLayerRadii;
    /** Motion transitions per animated key. Empty means no transition is configured: render a plain div. */
    transition: Record<string, unknown>;
    role: FillLayerRole;
    /** Fired when the layer's own animation settles; the crossfade uses it to drop the outgoing layer. */
    onAnimationComplete?: () => void;
};

export function FillLayer({
    paint,
    opacity,
    initialOpacity = null,
    radii,
    transition,
    role,
    onAnimationComplete,
}: FillLayerProps) {
    const paintStyle: CSSProperties = {
        position: "absolute",
        inset: 0,
        zIndex: FILL_LAYER_Z_INDEX,
        // The fill is scenery: clicks, drags and the crop overlay all belong to what is above it.
        pointerEvents: "none",
        ...(paint.image ? { backgroundImage: paint.image } : {}),
        ...(paint.color ? { backgroundColor: paint.color } : {}),
    };
    const kind = paint.image ? "gradient" : "color";
    // Whether this layer is the one holding still - reported because "did the outgoing layer hold?"
    // is the question rule 2 answers, and it is otherwise invisible to anything watching the DOM.
    const holds = role === "outgoing" && initialOpacity !== null && opacity >= initialOpacity;
    const attributes = {
        [FILL_LAYER_ATTRIBUTE]: role,
        "data-ui-fill-layer-kind": kind,
        ...(role === "outgoing" ? { "data-ui-fill-layer-hold": holds ? "true" : "false" } : {}),
    };

    // Radii ride in `animate` rather than `borderRadius: inherit` so a corner transition moves the
    // fill with the chrome instead of snapping it - the same reason the image fill spells them out.
    const animate = { opacity, ...radii };

    if (Object.keys(transition).length === 0) {
        return (
            <div
                aria-hidden="true"
                {...attributes}
                style={{ ...paintStyle, ...animate }}
            />
        );
    }

    return (
        <motion.div
            aria-hidden="true"
            {...attributes}
            style={paintStyle}
            initial={initialOpacity === null ? false : { opacity: initialOpacity, ...radii }}
            animate={animate}
            transition={transition}
            onAnimationComplete={onAnimationComplete}
        />
    );
}
