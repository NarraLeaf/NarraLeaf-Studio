import { useCallback, useEffect, useState, type CSSProperties, type HTMLAttributes } from "react";
import { motion } from "motion/react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { ensureCropPlacement, getRectangleLikeProps, normalizeImageFill } from "./rectangleHelpers";
import {
    FILL_LAYER_ROOT_STYLE,
    FillLayer,
    fillPaintNeedsLayer,
    planFillCrossfade,
    resolveColorFillPaint,
    resolveGradientFillPaint,
    type FillCrossfadePlan,
    type FillLayerRadii,
    type FillPaint,
} from "./FillLayer";
import { DEFAULT_GRADIENT_FILL, normalizeGradientFill } from "@shared/types/ui-editor/gradientFill";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { strokeSideApplies, type StrokeEdge } from "./strokeSideSpec";
import type { AppearanceFieldTransition, AppearancePropertyKey } from "@shared/types/ui-editor/appearance";
import { DEFAULT_ELEMENT_EFFECT_VALUES, effectFilterStoredToCss } from "@shared/types/ui-editor/effects";
import { toRuntimeMotionTransition } from "../appearance/appearanceMotion";
import { composeChromeEffectLayers } from "../effects/effectStyleComposer";

const objectFitMap: Record<string, CSSProperties["objectFit"] | undefined> = {
    cover: "cover",
    contain: "contain",
    stretch: "fill",
    crop: "none",
    tile: undefined,
};

type RectangleChromeRendererProps = WidgetRendererProps & {
    /**
     * When false, allow children to paint outside the chrome box (`overflow: visible`).
     * For `nl.container` stack/scroll, this mirrors widget `clipContent`; for `free` layout the host wrapper
     * owns clipping instead and chrome typically passes false to avoid double-clipping.
     */
    clipContent?: boolean;
    /** Resolved chrome from AppearanceResolver; when set, `element.props` is not read for rectangle-like fields. */
    rectangleLike?: RectangleLikeProps;
    /** Merged into the root chrome div style (e.g. cursor, opacity for buttons). */
    extraRootStyle?: CSSProperties;
    /** Extra attributes on the root chrome div (e.g. role, tabIndex, keyboard handlers). */
    extraRootProps?: Omit<HTMLAttributes<HTMLDivElement>, "onDrag" | "onDragStart" | "onDragEnd">;
    /** Optional field-level appearance transitions for motion-capable chrome properties. */
    appearanceTransitions?: Partial<Record<AppearancePropertyKey, AppearanceFieldTransition>>;
    /** Root chrome opacity factor for interaction states (e.g. button disabled). */
    rootOpacityFactor?: number;
};

function firstTransition(
    transitions: Partial<Record<AppearancePropertyKey, AppearanceFieldTransition>> | undefined,
    keys: AppearancePropertyKey[]
): AppearanceFieldTransition | null {
    if (!transitions) {
        return null;
    }
    for (const key of keys) {
        const transition = transitions[key];
        if (transition) {
            return transition;
        }
    }
    return null;
}

/** The fill that is leaving, kept mounted for as long as the incoming one takes to arrive. */
type FillCrossfadeState = {
    from: FillPaint;
    /** The opacity the outgoing layer was painting at, so it can be held there or faded from it. */
    fromOpacity: number;
    plan: FillCrossfadePlan;
    /** Bumped per crossfade; keys the incoming layer so it mounts fresh and can animate in. */
    epoch: number;
};

function assignMotionTransition(
    target: Record<string, unknown>,
    property: string,
    transition: AppearanceFieldTransition | null
) {
    if (!transition) {
        return;
    }
    target[property] = toRuntimeMotionTransition(transition);
}

export function RectangleChromeRenderer({
    element,
    children,
    hostAdapter,
    clipContent = true,
    rectangleLike,
    extraRootStyle,
    extraRootProps,
    appearanceTransitions,
    rootOpacityFactor = 1,
}: RectangleChromeRendererProps) {
    const props = rectangleLike ?? getRectangleLikeProps(element);
    const effectValues = props.effects ?? DEFAULT_ELEMENT_EFFECT_VALUES;
    const composedEffects = composeChromeEffectLayers(effectValues);
    const baseImageFlipX = props.imageFlipX === true ? -1 : 1;
    const baseImageFlipY = props.imageFlipY === true ? -1 : 1;
    const imageFlipVarStyle = {
        "--nl-image-base-flip-x": String(baseImageFlipX),
        "--nl-image-base-flip-y": String(baseImageFlipY),
    } as CSSProperties;
    const imageFillTransform =
        "scale(calc(var(--nl-image-base-flip-x, 1) * var(--nl-image-drag-flip-x, 1)), calc(var(--nl-image-base-flip-y, 1) * var(--nl-image-drag-flip-y, 1)))";
    const stateService = hostAdapter.editorStateService ?? UIEditorStateService.getInstance();
    const [interactionOverride, setInteractionOverride] = useState(() => stateService.getInteractionOverride());

    useEffect(() => {
        const unsubscribe = stateService.on("interactionOverrideChanged", payload => {
            setInteractionOverride(payload.next);
        });
        return () => unsubscribe();
    }, [stateService]);

    const normalizedFillOpacity = Math.max(0, Math.min(1, props.fillOpacity));
    const parsedBg = parseColorValue(String(props.backgroundColor ?? ""), { hex: "#FFFFFF", alpha: 1 });
    const colorFill =
        props.fillVisible && props.fillType === "color"
            ? colorValueToCss({
                  hex: parsedBg.hex,
                  alpha: normalizedFillOpacity * (parsedBg.alpha ?? 1),
              })
            : "transparent";

    const cornerRadii: FillLayerRadii = {
        borderTopLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTL,
        borderTopRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTR,
        borderBottomRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBR,
        borderBottomLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBL,
    };

    // The layer animates `fillOpacity` / `fillVisible` and the corner radii - the same keys the image
    // fill already animates, so a gradient's opacity transition needs no appearance key of its own.
    const fillTransition: Record<string, unknown> = {};
    assignMotionTransition(
        fillTransition,
        "opacity",
        firstTransition(appearanceTransitions, ["fillOpacity", "fillVisible"])
    );
    assignMotionTransition(
        fillTransition,
        "borderTopLeftRadius",
        firstTransition(appearanceTransitions, ["borderRadiusTL", "borderRadius"])
    );
    assignMotionTransition(
        fillTransition,
        "borderTopRightRadius",
        firstTransition(appearanceTransitions, ["borderRadiusTR", "borderRadius"])
    );
    assignMotionTransition(
        fillTransition,
        "borderBottomRightRadius",
        firstTransition(appearanceTransitions, ["borderRadiusBR", "borderRadius"])
    );
    assignMotionTransition(
        fillTransition,
        "borderBottomLeftRadius",
        firstTransition(appearanceTransitions, ["borderRadiusBL", "borderRadius"])
    );
    // Only an opacity transition can pace a crossfade. A widget whose corners transition but whose
    // fill does not has asked for no fill animation, and motion's default timing is not an answer to
    // a question the author never put.
    const fillOpacityAnimated = Object.prototype.hasOwnProperty.call(fillTransition, "opacity");

    /**
     * The fill as a layer would paint it, or `null` when the layer has no business in it - an image
     * fill, which the `<img>` path owns, or a fill type this build has never heard of.
     *
     * A `gradient` fill whose payload is missing or unreadable falls back to the gradient the author
     * would have been given when they first chose one, rather than painting nothing: `fillType` is
     * the field that says a gradient is wanted, and a widget that silently disappears is the worse
     * reading of a document that has lost a field.
     */
    const layerPaint: FillPaint | null =
        props.fillType === "gradient"
            ? resolveGradientFillPaint(normalizeGradientFill(props.gradientFill) ?? DEFAULT_GRADIENT_FILL)
            : props.fillType === "color"
              ? // `parsedBg` again, not the stored string: one parse per render, and a brand link is
                // a palette lookup. It cannot share `colorFill`, which folds `fillOpacity` into the
                // colour - the layer carries that as its own opacity instead, so that an opacity
                // change animates the layer rather than reading as a change of fill.
                resolveColorFillPaint(parsedBg)
              : null;
    const layerOpacity = props.fillVisible ? normalizedFillOpacity : 0;
    const incomingOpaque = Boolean(layerPaint?.opaque) && props.fillVisible && normalizedFillOpacity >= 1;

    const [lastFill, setLastFill] = useState<{ paint: FillPaint | null; opacity: number }>(() => ({
        paint: layerPaint,
        opacity: layerOpacity,
    }));
    const [fillEpoch, setFillEpoch] = useState(0);
    const [crossfade, setCrossfade] = useState<FillCrossfadeState | null>(null);
    const endCrossfade = useCallback(() => setCrossfade(null), []);

    if ((lastFill.paint?.signature ?? "") !== (layerPaint?.signature ?? "")) {
        /**
         * State adjusted during render rather than in an effect, because an effect runs one paint too
         * late: the new fill would land at full opacity for a frame and only then start fading in
         * from underneath itself, which is the flash the crossfade exists to remove.
         *
         * A colour replacing a colour is not crossfaded - motion interpolating one `background-color`
         * on the root is both cheaper and smoother than two layers, and it is the path the common
         * case has always taken. Only a gradient on one side of the change needs layers, because
         * there is no interpolation between a gradient and anything.
         *
         * Interrupting a crossfade restarts it from the outgoing layer's authored opacity rather than
         * from wherever motion had got to; the live value belongs to a DOM node that is about to be
         * replaced, and reading it back would cost a layout for a frame nobody sees.
         */
        const crossfades =
            fillOpacityAnimated &&
            lastFill.paint !== null &&
            layerPaint !== null &&
            (fillPaintNeedsLayer(lastFill.paint) || fillPaintNeedsLayer(layerPaint));
        setLastFill({ paint: layerPaint, opacity: layerOpacity });
        if (crossfades && lastFill.paint) {
            setFillEpoch(fillEpoch + 1);
            setCrossfade({
                from: lastFill.paint,
                fromOpacity: lastFill.opacity,
                plan: planFillCrossfade(incomingOpaque, lastFill.opacity),
                epoch: fillEpoch + 1,
            });
        } else if (crossfade) {
            setCrossfade(null);
        }
    }

    /** Ruling 4.1: mounted for a gradient, or while a crossfade runs, and at no other time. */
    const fillLayerActive = fillPaintNeedsLayer(layerPaint) || crossfade !== null;

    const normalizedStrokeOpacity = Math.max(0, Math.min(1, props.strokeOpacity));
    const parsedStroke = parseColorValue(String(props.borderColor ?? ""), { hex: "#FFFFFF", alpha: 1 });
    const strokeColor = colorValueToCss({
        hex: parsedStroke.hex,
        alpha: normalizedStrokeOpacity * (parsedStroke.alpha ?? 1),
    });

    const style: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        ...extraRootStyle,
        // A stacking context, so the layer's negative z-index stays inside this widget.
        ...(fillLayerActive ? FILL_LAYER_ROOT_STYLE : {}),
    };

    const tx = Number.isFinite(props.transformOffsetX) ? props.transformOffsetX : 0;
    const ty = Number.isFinite(props.transformOffsetY) ? props.transformOffsetY : 0;
    const ts = Number.isFinite(props.transformScale) && props.transformScale > 0 ? props.transformScale : 1;
    const tr = Number.isFinite(props.transformRotation) ? props.transformRotation : 0;
    const combinedRootOpacity = Math.max(0, Math.min(1, rootOpacityFactor));
    const transformCss = `translate(${tx}px, ${ty}px) scale(${ts}) rotate(${tr}deg)`;

    // Ensure first paint matches resolved chrome: motion `animate` alone can miss the initial frame.
    if (fillLayerActive) {
        // The layers own the fill. Writing `transparent` here rather than leaving the property out
        // clears, in the same commit the layer mounts, any colour motion had been animating onto this
        // node - which would otherwise sit under a translucent gradient and tint it.
        style.backgroundColor = "transparent";
    } else if (props.fillVisible && props.fillType === "color") {
        style.backgroundColor = colorFill;
    }

    /** Align with compact appearance: no stroke when hidden, zero width, style none, or align "none". */
    const wantsStroke =
        props.strokeVisible !== false &&
        props.borderWidth > 0 &&
        props.borderStyle !== "none" &&
        props.strokeAlign !== "none";

    const rootAnimate: Record<string, string | number> = {
        // Left out entirely while the layers own the fill, so motion neither interpolates towards a
        // colour that is not being painted here nor turns a static gradient into an animated node.
        ...(fillLayerActive ? {} : { backgroundColor: colorFill }),
        borderTopLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTL,
        borderTopRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTR,
        borderBottomRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBR,
        borderBottomLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBL,
        x: tx,
        y: ty,
        scale: ts,
        rotate: tr,
        opacity: combinedRootOpacity,
    };
    const rootTransition: Record<string, unknown> = {};
    if (!fillLayerActive) {
        assignMotionTransition(
            rootTransition,
            "backgroundColor",
            firstTransition(appearanceTransitions, ["backgroundColor", "fillOpacity", "fillVisible"])
        );
    }
    assignMotionTransition(
        rootTransition,
        "borderTopLeftRadius",
        firstTransition(appearanceTransitions, ["borderRadiusTL", "borderRadius"])
    );
    assignMotionTransition(
        rootTransition,
        "borderTopRightRadius",
        firstTransition(appearanceTransitions, ["borderRadiusTR", "borderRadius"])
    );
    assignMotionTransition(
        rootTransition,
        "borderBottomRightRadius",
        firstTransition(appearanceTransitions, ["borderRadiusBR", "borderRadius"])
    );
    assignMotionTransition(
        rootTransition,
        "borderBottomLeftRadius",
        firstTransition(appearanceTransitions, ["borderRadiusBL", "borderRadius"])
    );
    assignMotionTransition(
        rootTransition,
        "x",
        firstTransition(appearanceTransitions, ["transformOffsetX"])
    );
    assignMotionTransition(
        rootTransition,
        "y",
        firstTransition(appearanceTransitions, ["transformOffsetY"])
    );
    assignMotionTransition(
        rootTransition,
        "scale",
        firstTransition(appearanceTransitions, ["transformScale"])
    );
    assignMotionTransition(
        rootTransition,
        "rotate",
        firstTransition(appearanceTransitions, ["transformRotation"])
    );
    if (!effectFilterStoredToCss(effectValues.effectFilter).trim()) {
        assignMotionTransition(
            rootTransition,
            "filter",
            firstTransition(appearanceTransitions, ["effectBlur"])
        );
    }
    assignMotionTransition(
        rootTransition,
        "backdropFilter",
        firstTransition(appearanceTransitions, ["effectBackgroundBlur"])
    );

    if (wantsStroke) {
        style.border = "none";
        if (props.strokeAlign === "outside") {
            style.border = "none";
            style.outlineStyle = props.borderStyle as CSSProperties["outlineStyle"];
            // Mirror rootAnimate outline so the first paint is visible before motion applies.
            style.outlineWidth = props.borderWidth;
            style.outlineColor = strokeColor;
            style.outlineOffset = props.borderWidth;
        } else {
            style.border = "none";
        }
    } else {
        style.border = "none";
    }

    const strokeStyle: CSSProperties | null =
        wantsStroke && props.strokeAlign !== "outside"
            ? {
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  boxSizing: "border-box",
              }
            : null;

    if (strokeStyle) {
        strokeStyle.borderStyle = props.borderStyle;
        if (props.strokeAlign === "center") {
            const sideWidth = (side: StrokeEdge) =>
                strokeSideApplies(props.strokeSide, side) ? `${props.borderWidth}px` : "0px";

            strokeStyle.borderWidth = "0px";
            strokeStyle.borderTopWidth = sideWidth("top");
            strokeStyle.borderRightWidth = sideWidth("right");
            strokeStyle.borderBottomWidth = sideWidth("bottom");
            strokeStyle.borderLeftWidth = sideWidth("left");
            strokeStyle.borderColor = strokeColor;
        } else if (props.strokeAlign === "inside") {
            strokeStyle.border = "none";
            strokeStyle.boxShadow = `inset 0 0 0 ${props.borderWidth}px ${strokeColor}`;
        } else {
            strokeStyle.border = "none";
        }
    }

    const legacyImageUrl = props.backgroundImage?.trim() ?? "";
    const activeFill = normalizeImageFill(props);
    const activeMode = activeFill?.mode;
    const { url: assetUrl } = useAssetObjectUrl(activeFill?.assetId ?? null);
    const displayUrl = assetUrl ?? (legacyImageUrl ? legacyImageUrl : null);
    const shouldRenderImage = props.fillType === "image";
    const isCropEditing =
        Boolean(activeMode) &&
        activeMode !== "tile" &&
        displayUrl &&
        interactionOverride?.kind === "imageCrop" &&
        interactionOverride.elementId === element.id;

    // `overflow: hidden` on the same node clips `box-shadow` and can trim `filter` / `backdrop-filter` output.
    const hasChromeVisualOverflowEffects =
        Boolean(composedEffects.rootBoxShadow && composedEffects.rootBoxShadow !== "none") ||
        Boolean(composedEffects.rootFilter && composedEffects.rootFilter !== "none") ||
        Boolean(composedEffects.backdropFilter && composedEffects.backdropFilter !== "none");
    const useClipIsolation = clipContent && hasChromeVisualOverflowEffects;
    style.overflow = useClipIsolation
        ? "visible"
        : isCropEditing || !clipContent
          ? "visible"
          : "hidden";

    if (shouldRenderImage && activeMode === "tile" && displayUrl) {
        Object.assign(style, {
            backgroundImage: `url(${displayUrl})`,
            backgroundRepeat: "repeat",
            backgroundSize: "auto",
            backgroundPosition: "top left",
        });
    }

    const imageAnimate = {
        opacity: shouldRenderImage && props.fillVisible ? normalizedFillOpacity : 0,
        borderTopLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTL,
        borderTopRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTR,
        borderBottomRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBR,
        borderBottomLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBL,
    };
    const imageTransition: Record<string, unknown> = {};
    assignMotionTransition(
        imageTransition,
        "opacity",
        firstTransition(appearanceTransitions, ["fillOpacity", "fillVisible"])
    );
    assignMotionTransition(
        imageTransition,
        "borderTopLeftRadius",
        firstTransition(appearanceTransitions, ["borderRadiusTL", "borderRadius"])
    );
    assignMotionTransition(
        imageTransition,
        "borderTopRightRadius",
        firstTransition(appearanceTransitions, ["borderRadiusTR", "borderRadius"])
    );
    assignMotionTransition(
        imageTransition,
        "borderBottomRightRadius",
        firstTransition(appearanceTransitions, ["borderRadiusBR", "borderRadius"])
    );
    assignMotionTransition(
        imageTransition,
        "borderBottomLeftRadius",
        firstTransition(appearanceTransitions, ["borderRadiusBL", "borderRadius"])
    );

    const imageMotionActive = Object.keys(imageTransition).length > 0;

    const strokeAnimate: Record<string, string | number> = {
        borderTopLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTL,
        borderTopRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTR,
        borderBottomRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBR,
        borderBottomLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBL,
    };
    const strokeTransition: Record<string, unknown> = {};
    assignMotionTransition(
        strokeTransition,
        "borderTopLeftRadius",
        firstTransition(appearanceTransitions, ["borderRadiusTL", "borderRadius"])
    );
    assignMotionTransition(
        strokeTransition,
        "borderTopRightRadius",
        firstTransition(appearanceTransitions, ["borderRadiusTR", "borderRadius"])
    );
    assignMotionTransition(
        strokeTransition,
        "borderBottomRightRadius",
        firstTransition(appearanceTransitions, ["borderRadiusBR", "borderRadius"])
    );
    assignMotionTransition(
        strokeTransition,
        "borderBottomLeftRadius",
        firstTransition(appearanceTransitions, ["borderRadiusBL", "borderRadius"])
    );

    const renderImage = () => {
        if (!shouldRenderImage || !displayUrl || !activeMode || activeMode === "tile") {
            return null;
        }
        const imagePointerEvents = activeMode === "crop" || isCropEditing ? "auto" : "none";
        if (activeMode === "crop") {
            const placement = ensureCropPlacement(activeFill);
            const cropMotionAnimate = {
                ...imageAnimate,
                left: `${placement.leftPct}%`,
                top: `${placement.topPct}%`,
                width: `${placement.widthPct}%`,
                height: `${placement.heightPct}%`,
            };
            const cropStaticStyle: CSSProperties = {
                position: "absolute",
                maxWidth: "none",
                maxHeight: "none",
                objectFit: "fill",
                transform: imageFillTransform,
                transformOrigin: "center center",
                pointerEvents: imagePointerEvents,
                left: cropMotionAnimate.left,
                top: cropMotionAnimate.top,
                width: cropMotionAnimate.width,
                height: cropMotionAnimate.height,
                opacity: cropMotionAnimate.opacity,
                borderTopLeftRadius: cropMotionAnimate.borderTopLeftRadius,
                borderTopRightRadius: cropMotionAnimate.borderTopRightRadius,
                borderBottomRightRadius: cropMotionAnimate.borderBottomRightRadius,
                borderBottomLeftRadius: cropMotionAnimate.borderBottomLeftRadius,
            };
            if (imageMotionActive) {
                return (
                    <motion.img
                        data-ui-image-fill="true"
                        data-ui-image-fill-mode={activeMode}
                        data-ui-image-fill-asset-id={activeFill?.assetId ?? ""}
                        src={displayUrl}
                        alt=""
                        draggable={false}
                        initial={false}
                        animate={cropMotionAnimate}
                        transition={imageTransition}
                        style={{
                            position: "absolute",
                            maxWidth: "none",
                            maxHeight: "none",
                            objectFit: "fill",
                            transform: imageFillTransform,
                            transformOrigin: "center center",
                            pointerEvents: imagePointerEvents,
                        }}
                    />
                );
            }
            return (
                <img
                    data-ui-image-fill="true"
                    data-ui-image-fill-mode={activeMode}
                    data-ui-image-fill-asset-id={activeFill?.assetId ?? ""}
                    src={displayUrl}
                    alt=""
                    draggable={false}
                    style={cropStaticStyle}
                />
            );
        }

        const objectFit = objectFitMap[activeMode] ?? "cover";
        const fillStaticStyle: CSSProperties = {
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit,
            transform: imageFillTransform,
            transformOrigin: "center center",
            pointerEvents: imagePointerEvents,
            opacity: imageAnimate.opacity,
            borderTopLeftRadius: imageAnimate.borderTopLeftRadius,
            borderTopRightRadius: imageAnimate.borderTopRightRadius,
            borderBottomRightRadius: imageAnimate.borderBottomRightRadius,
            borderBottomLeftRadius: imageAnimate.borderBottomLeftRadius,
        };
        if (imageMotionActive) {
            return (
                <motion.img
                    data-ui-image-fill="true"
                    data-ui-image-fill-mode={activeMode}
                    data-ui-image-fill-asset-id={activeFill?.assetId ?? ""}
                    src={displayUrl}
                    alt=""
                    draggable={false}
                    initial={false}
                    animate={imageAnimate}
                    transition={imageTransition}
                    style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit,
                        transform: imageFillTransform,
                        transformOrigin: "center center",
                        pointerEvents: imagePointerEvents,
                    }}
                />
            );
        }
        return (
            <img
                data-ui-image-fill="true"
                data-ui-image-fill-mode={activeMode}
                data-ui-image-fill-asset-id={activeFill?.assetId ?? ""}
                src={displayUrl}
                alt=""
                draggable={false}
                style={fillStaticStyle}
            />
        );
    };

    if (strokeStyle) {
        const strokeColorTransition = firstTransition(appearanceTransitions, [
            "borderColor",
            "strokeOpacity",
            "strokeVisible",
        ]);
        const strokeWidthTransition = firstTransition(appearanceTransitions, ["borderWidth"]);

        if (props.strokeAlign === "center") {
            const sideWidth = (side: StrokeEdge) =>
                strokeSideApplies(props.strokeSide, side) ? props.borderWidth : 0;
            strokeAnimate.borderTopWidth = sideWidth("top");
            strokeAnimate.borderRightWidth = sideWidth("right");
            strokeAnimate.borderBottomWidth = sideWidth("bottom");
            strokeAnimate.borderLeftWidth = sideWidth("left");
            strokeAnimate.borderTopColor = strokeColor;
            strokeAnimate.borderRightColor = strokeColor;
            strokeAnimate.borderBottomColor = strokeColor;
            strokeAnimate.borderLeftColor = strokeColor;
            assignMotionTransition(strokeTransition, "borderTopWidth", strokeWidthTransition);
            assignMotionTransition(strokeTransition, "borderRightWidth", strokeWidthTransition);
            assignMotionTransition(strokeTransition, "borderBottomWidth", strokeWidthTransition);
            assignMotionTransition(strokeTransition, "borderLeftWidth", strokeWidthTransition);
            assignMotionTransition(strokeTransition, "borderTopColor", strokeColorTransition);
            assignMotionTransition(strokeTransition, "borderRightColor", strokeColorTransition);
            assignMotionTransition(strokeTransition, "borderBottomColor", strokeColorTransition);
            assignMotionTransition(strokeTransition, "borderLeftColor", strokeColorTransition);
        } else if (props.strokeAlign === "inside") {
            strokeAnimate.boxShadow = `inset 0 0 0 ${props.borderWidth}px ${strokeColor}`;
            assignMotionTransition(
                strokeTransition,
                "boxShadow",
                strokeWidthTransition ?? strokeColorTransition
            );
        }
    }

    if (wantsStroke && props.strokeAlign === "outside") {
        rootAnimate.outlineWidth = props.borderWidth;
        rootAnimate.outlineColor = strokeColor;
        rootAnimate.outlineOffset = props.borderWidth;
        assignMotionTransition(rootTransition, "outlineWidth", firstTransition(appearanceTransitions, ["borderWidth"]));
        assignMotionTransition(
            rootTransition,
            "outlineColor",
            firstTransition(appearanceTransitions, ["borderColor", "strokeOpacity", "strokeVisible"])
        );
        assignMotionTransition(rootTransition, "outlineOffset", firstTransition(appearanceTransitions, ["borderWidth"]));
    }

    const hasAnimatedFilter = Object.prototype.hasOwnProperty.call(rootTransition, "filter");
    const hasAnimatedBackdrop = Object.prototype.hasOwnProperty.call(rootTransition, "backdropFilter");
    if (hasAnimatedFilter) {
        rootAnimate.filter = composedEffects.rootFilter ?? "none";
    }
    if (hasAnimatedBackdrop) {
        rootAnimate.backdropFilter = composedEffects.backdropFilter ?? "none";
    }

    const strokeCornerRadii: CSSProperties = {
        borderTopLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTL,
        borderTopRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTR,
        borderBottomRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBR,
        borderBottomLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBL,
    };

    const rootMotionActive = Object.keys(rootTransition).length > 0;
    const strokeMotionActive = Boolean(strokeStyle && Object.keys(strokeTransition).length > 0);

    const rootBaseStyle: CSSProperties = {
        ...style,
        ...imageFlipVarStyle,
        ...(composedEffects.mixBlendMode ? { mixBlendMode: composedEffects.mixBlendMode } : {}),
        ...(composedEffects.rootBoxShadow ? { boxShadow: composedEffects.rootBoxShadow } : {}),
        ...(!hasAnimatedFilter && composedEffects.rootFilter ? { filter: composedEffects.rootFilter } : {}),
        ...(!hasAnimatedBackdrop && composedEffects.backdropFilter ? { backdropFilter: composedEffects.backdropFilter } : {}),
    };
    const rootStaticStyle: CSSProperties = {
        ...rootBaseStyle,
        ...strokeCornerRadii,
        transform: transformCss,
        opacity: combinedRootOpacity,
        ...(composedEffects.rootFilter ? { filter: composedEffects.rootFilter } : {}),
        ...(composedEffects.backdropFilter ? { backdropFilter: composedEffects.backdropFilter } : {}),
        ...(composedEffects.rootBoxShadow ? { boxShadow: composedEffects.rootBoxShadow } : {}),
    };

    /**
     * The fill, when the root cannot paint it alone.
     *
     * Both layers sit below the image, the stroke and the crop overlay - all three are positioned and
     * so paint above a negative z-index - and below the children, which is the whole point of that
     * z-index. The outgoing layer is listed first so the incoming one is above it in DOM order too,
     * which costs nothing and keeps the markup readable.
     */
    const renderFillLayers = () => {
        if (!fillLayerActive) {
            return null;
        }
        return (
            <>
                {crossfade ? (
                    <FillLayer
                        key={`fill-out-${crossfade.epoch}`}
                        role="outgoing"
                        paint={crossfade.from}
                        opacity={crossfade.plan.outgoingTo}
                        initialOpacity={crossfade.fromOpacity}
                        radii={cornerRadii}
                        transition={fillTransition}
                    />
                ) : null}
                {layerPaint ? (
                    <FillLayer
                        key={`fill-${fillEpoch}`}
                        role="current"
                        paint={layerPaint}
                        opacity={layerOpacity}
                        initialOpacity={crossfade ? crossfade.plan.incomingFrom : null}
                        radii={cornerRadii}
                        transition={fillTransition}
                        // The incoming layer always has a real animation to run - it starts at 0 -
                        // so its completion is a duration-free signal that the crossfade is over,
                        // which a timer would have to guess at for a spring.
                        onAnimationComplete={crossfade ? endCrossfade : undefined}
                    />
                ) : null}
            </>
        );
    };

    const chromeInner = (
        <>
            {renderFillLayers()}
            {renderImage()}
            {isCropEditing && <div className="ui-image-crop-mask" aria-hidden="true" />}
            {strokeStyle ? (
                strokeMotionActive ? (
                    <motion.div
                        aria-hidden="true"
                        style={strokeStyle}
                        initial={false}
                        animate={strokeAnimate}
                        transition={strokeTransition}
                    />
                ) : (
                    <div aria-hidden="true" style={{ ...strokeStyle, ...strokeCornerRadii }} />
                )
            ) : null}
            {children}
        </>
    );

    const innerClipStyle: CSSProperties = {
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: isCropEditing || !clipContent ? "visible" : "hidden",
        borderRadius: "inherit",
    };

    const chromeChildren = useClipIsolation ? <div style={innerClipStyle}>{chromeInner}</div> : chromeInner;

    return rootMotionActive ? (
        <motion.div
            style={rootBaseStyle}
            initial={false}
            animate={rootAnimate}
            transition={rootTransition}
            data-ui-image-crop-active={isCropEditing ? "true" : "false"}
            {...(extraRootProps as Record<string, unknown>)}
        >
            {chromeChildren}
        </motion.div>
    ) : (
        <div
            style={rootStaticStyle}
            data-ui-image-crop-active={isCropEditing ? "true" : "false"}
            {...(extraRootProps as Record<string, unknown>)}
        >
            {chromeChildren}
        </div>
    );
}
