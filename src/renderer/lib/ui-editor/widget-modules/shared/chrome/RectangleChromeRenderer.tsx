import { useEffect, useState, type CSSProperties, type HTMLAttributes } from "react";
import { motion } from "motion/react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { ensureCropPlacement, getRectangleLikeProps, normalizeImageFill } from "./rectangleHelpers";
import type { RectangleLikeProps, StrokeSide } from "@shared/types/ui-editor/rectangleLike";
import type { AppearanceFieldTransition, AppearancePropertyKey } from "@shared/types/ui-editor/appearance";
import { toRuntimeMotionTransition } from "../appearance/appearanceMotion";

const objectFitMap: Record<string, CSSProperties["objectFit"] | undefined> = {
    cover: "cover",
    contain: "contain",
    stretch: "fill",
    crop: "none",
    tile: undefined,
};

type RectangleChromeRendererProps = WidgetRendererProps & {
    /** When false, allow children to paint outside the box (matches `nl.container` clipContent off). */
    clipContent?: boolean;
    /** Resolved chrome from AppearanceResolver; when set, `element.props` is not read for rectangle-like fields. */
    rectangleLike?: RectangleLikeProps;
    /** Merged into the root chrome div style (e.g. cursor, opacity for buttons). */
    extraRootStyle?: CSSProperties;
    /** Extra attributes on the root chrome div (e.g. role, tabIndex, keyboard handlers). */
    extraRootProps?: Omit<HTMLAttributes<HTMLDivElement>, "onDrag" | "onDragStart" | "onDragEnd">;
    /** Optional field-level appearance transitions for motion-capable chrome properties. */
    appearanceTransitions?: Partial<Record<AppearancePropertyKey, AppearanceFieldTransition>>;
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
    clipContent = true,
    rectangleLike,
    extraRootStyle,
    extraRootProps,
    appearanceTransitions,
}: RectangleChromeRendererProps) {
    const props = rectangleLike ?? getRectangleLikeProps(element);
    const stateService = UIEditorStateService.getInstance();
    const [interactionOverride, setInteractionOverride] = useState(() => stateService.getInteractionOverride());

    useEffect(() => {
        const unsubscribe = stateService.on("interactionOverrideChanged", setInteractionOverride);
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
        overflow: clipContent ? "hidden" : "visible",
        position: "relative",
        ...extraRootStyle,
    };

    // Ensure first paint matches resolved chrome: motion `animate` alone can miss the initial frame.
    if (props.fillVisible && props.fillType === "color") {
        style.backgroundColor = colorFill;
    }

    /** Align with compact appearance: no stroke when hidden, zero width, style none, or align "none". */
    const wantsStroke =
        props.strokeVisible !== false &&
        props.borderWidth > 0 &&
        props.borderStyle !== "none" &&
        props.strokeAlign !== "none";

    const rootAnimate: Record<string, string | number> = {
        backgroundColor: colorFill,
        borderTopLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTL,
        borderTopRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTR,
        borderBottomRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBR,
        borderBottomLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBL,
    };
    const rootTransition: Record<string, unknown> = {};
    assignMotionTransition(
        rootTransition,
        "backgroundColor",
        firstTransition(appearanceTransitions, ["backgroundColor", "fillOpacity", "fillVisible"])
    );
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

    if (wantsStroke) {
        style.border = "none";
        if (props.strokeAlign === "outside") {
            style.border = "none";
            style.outlineStyle = props.borderStyle;
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
            const sideWidth = (side: StrokeSide) =>
                props.strokeSide === "all" || props.strokeSide === side ? `${props.borderWidth}px` : "0px";

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
        activeMode === "crop" &&
        displayUrl &&
        interactionOverride?.kind === "imageCrop" &&
        interactionOverride.elementId === element.id;

    if (isCropEditing) {
        style.overflow = "visible";
    }

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
        const imagePointerEvents = activeMode === "crop" ? "auto" : "none";
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
                            pointerEvents: imagePointerEvents,
                        }}
                    />
                );
            }
            return (
                <img
                    data-ui-image-fill="true"
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
                        pointerEvents: imagePointerEvents,
                    }}
                />
            );
        }
        return (
            <img data-ui-image-fill="true" src={displayUrl} alt="" draggable={false} style={fillStaticStyle} />
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
            const sideWidth = (side: StrokeSide) =>
                props.strokeSide === "all" || props.strokeSide === side ? props.borderWidth : 0;
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

    const strokeCornerRadii: CSSProperties = {
        borderTopLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTL,
        borderTopRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusTR,
        borderBottomRightRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBR,
        borderBottomLeftRadius: props.borderRadiusLinked ? props.borderRadius : props.borderRadiusBL,
    };

    const rootMotionActive = Object.keys(rootTransition).length > 0;
    const strokeMotionActive = Boolean(strokeStyle && Object.keys(strokeTransition).length > 0);

    const rootStaticStyle: CSSProperties = {
        ...style,
        ...strokeCornerRadii,
    };

    const chromeChildren = (
        <>
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

    return rootMotionActive ? (
        <motion.div
            style={style}
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
