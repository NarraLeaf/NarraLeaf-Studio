import { useEffect, useState, type CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { ensureCropPlacement, getProps, normalizeImageFill } from "./helpers";
import type { RectangleProps, StrokeSide } from "./types";

const objectFitMap: Record<string, CSSProperties["objectFit"] | undefined> = {
  cover: "cover",
  contain: "contain",
  stretch: "fill",
  crop: "none",
  tile: undefined,
};

export function RectangleRenderer({ element, children }: WidgetRendererProps) {
  const props = getProps(element);
  const stateService = UIEditorStateService.getInstance();
  const [interactionOverride, setInteractionOverride] = useState(() => stateService.getInteractionOverride());

  useEffect(() => {
    const unsubscribe = stateService.on("interactionOverrideChanged", setInteractionOverride);
    return () => unsubscribe();
  }, [stateService]);

  const borderRadius = props.borderRadiusLinked
    ? `${props.borderRadius}px`
    : `${props.borderRadiusTL}px ${props.borderRadiusTR}px ${props.borderRadiusBR}px ${props.borderRadiusBL}px`;

  const normalizedFillOpacity = Math.max(0, Math.min(1, props.fillOpacity));
  const colorFill =
    props.fillVisible && props.fillType === "color"
      ? colorValueToCss({ hex: props.backgroundColor, alpha: normalizedFillOpacity })
      : "transparent";

  const normalizedStrokeOpacity = Math.max(0, Math.min(1, props.strokeOpacity));
  const strokeColor = colorValueToCss({ hex: props.borderColor, alpha: normalizedStrokeOpacity });

  const style: CSSProperties = {
    width: "100%",
    height: "100%",
    backgroundColor: colorFill,
    borderRadius,
    boxSizing: "border-box",
    overflow: "hidden",
    position: "relative",
  };

  const hasStroke = props.strokeVisible && props.borderWidth > 0;
  if (hasStroke) {
    style.border = "none";
    if (props.strokeAlign === "outside") {
      style.border = "none";
      style.outline = `${props.borderWidth}px ${props.borderStyle} ${strokeColor}`;
      style.outlineOffset = `${props.borderWidth}px`;
    } else {
      style.border = "none";
    }
  } else {
    style.border = "none";
  }

  const strokeStyle: CSSProperties | null =
    hasStroke && props.strokeAlign !== "outside"
      ? {
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          borderRadius,
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
  const shouldRenderImage = props.fillVisible && props.fillType === "image";
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

  const renderImage = () => {
    if (!shouldRenderImage || !displayUrl || !activeMode || activeMode === "tile") {
      return null;
    }
    const imagePointerEvents = activeMode === "crop" ? "auto" : "none";
    if (activeMode === "crop") {
      const placement = ensureCropPlacement(activeFill);
      return (
        <img
          data-ui-image-fill="true"
          src={displayUrl}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: `${placement.leftPct}%`,
            top: `${placement.topPct}%`,
            width: `${placement.widthPct}%`,
            height: `${placement.heightPct}%`,
            maxWidth: "none",
            maxHeight: "none",
            objectFit: "fill",
            opacity: normalizedFillOpacity,
            pointerEvents: imagePointerEvents,
          }}
        />
      );
    }

    const objectFit = objectFitMap[activeMode] ?? "cover";
    return (
      <img
        data-ui-image-fill="true"
        src={displayUrl}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit,
          opacity: normalizedFillOpacity,
          pointerEvents: imagePointerEvents,
        }}
      />
    );
  };

  return (
    <div style={style} data-ui-image-crop-active={isCropEditing ? "true" : "false"}>
      {renderImage()}
      {isCropEditing && <div className="ui-image-crop-mask" aria-hidden="true" />}
      {strokeStyle && <div aria-hidden="true" style={strokeStyle} />}
      {children}
    </div>
  );
}
