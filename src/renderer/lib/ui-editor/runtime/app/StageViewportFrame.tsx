import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";

export type StageViewportSize = { width: number; height: number };

export function isUsableSize(
  size: StageViewportSize | null | undefined
): size is StageViewportSize {
  return Boolean(
    size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

/**
 * How the stage meets an area whose aspect ratio is not the design's: letterbox the whole design
 * (`contain`) or fill the area and crop the overflow (`cover`).
 */
export type StageViewportFit = "contain" | "cover";

/** Which part of the design survives a crop, named for what is KEPT (as in CSS `object-position`). */
export type StageCropAnchor = {
  x: "left" | "center" | "right";
  y: "top" | "center" | "bottom";
};

export const DEFAULT_STAGE_CROP_ANCHOR: StageCropAnchor = { x: "center", y: "center" };

export type StageViewportMetrics = {
  /** Scale from design units to the pixels the stage lays out at (what `getScale` should return). */
  renderScale: number;
  /** Backing box size in layout pixels. */
  backingWidth: number;
  backingHeight: number;
  /**
   * How much of the design falls outside the area, per axis, in layout pixels — 0 under `contain`,
   * where the bars are outside the design instead. Positive means that much IS being cropped.
   */
  croppedWidth: number;
  croppedHeight: number;
};

/**
 * Pure stage-sizing math shared by every run path: lay the stage out at `designSize` scaled against
 * the available `area` while preserving the design aspect ratio. `area` of `null`/0 falls back to
 * fit = 1 so nothing collapses to 0 before the first measurement.
 *
 * `contain` (the default, and what every run path did before cropping existed) takes the smaller
 * ratio, so the whole design fits and the leftover shows as bars. `cover` takes the larger one, so
 * the area is filled and the backing box overflows on exactly one axis — never both, since the
 * chosen ratio is exact on the other. The overflow is clipped by the frame, and which end of it goes
 * is the anchor's job, not this function's.
 */
export function computeStageViewportMetrics(input: {
  area: StageViewportSize | null;
  designSize: StageViewportSize;
  fit?: StageViewportFit;
}): StageViewportMetrics {
  const dw = input.designSize.width > 0 ? input.designSize.width : 1;
  const dh = input.designSize.height > 0 ? input.designSize.height : 1;
  // Fall back to fit = 1 until a usable area is measured (a collapsed/0 dimension must not drive the
  // backing size to 0 or shrink the stage — see the runtime viewport sizing).
  const usable = isUsableSize(input.area) ? input.area : null;
  const scale = usable
    ? input.fit === "cover"
      ? Math.max(usable.width / dw, usable.height / dh)
      : Math.min(usable.width / dw, usable.height / dh)
    : 1;
  const backingWidth = dw * scale;
  const backingHeight = dh * scale;
  return {
    renderScale: scale,
    backingWidth,
    backingHeight,
    croppedWidth: usable ? Math.max(0, backingWidth - usable.width) : 0,
    croppedHeight: usable ? Math.max(0, backingHeight - usable.height) : 0
  };
}

/** Flex alignment that keeps the anchored edge and lets the other one overflow out of the frame. */
function anchorToFlex(anchor: "left" | "center" | "right" | "top" | "bottom"): string {
  if (anchor === "left" || anchor === "top") {
    return "flex-start";
  }
  if (anchor === "right" || anchor === "bottom") {
    return "flex-end";
  }
  return "center";
}

export type StageViewportFrameProps = {
  /**
   * Logical design size the stage + surface content is authored in (the coordinate space).
   * Drives the aspect ratio and the backing scale.
   */
  designSize: StageViewportSize;
  /**
   * Reports the design → backing scale whenever it changes. Hosts feed this back into `getScale`
   * so the surface layers rasterize at the same backing resolution as the stage.
   */
  onRenderScaleChange?: (scale: number) => void;
  /** `contain` letterboxes (default); `cover` fills the frame and crops the overflow. */
  fit?: StageViewportFit;
  /** Which part survives the crop. Ignored under `contain`, where nothing is cropped. */
  cropAnchor?: StageCropAnchor;
  outerClassName?: string;
  outerStyle?: CSSProperties;
  boxClassName?: string;
  boxStyle?: CSSProperties;
  children?: ReactNode;
};

/**
 * Shared stage frame for every run path (Dev Mode + standalone runtime). Measures its own area and
 * lays the game content out in a `designSize × renderScale` box centred in that area, preserving the
 * design aspect ratio.
 */
export function StageViewportFrame(props: StageViewportFrameProps): ReactNode {
  const {
    designSize,
    onRenderScaleChange,
    fit = "contain",
    cropAnchor = DEFAULT_STAGE_CROP_ANCHOR,
    outerClassName,
    outerStyle,
    boxClassName,
    boxStyle,
    children
  } = props;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [area, setArea] = useState<StageViewportSize | null>(null);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setArea((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height }
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      if (typeof window !== "undefined") {
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
      }
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { renderScale, backingWidth, backingHeight } = computeStageViewportMetrics({
    area,
    designSize,
    fit
  });

  const reportRef = useRef(onRenderScaleChange);
  reportRef.current = onRenderScaleChange;
  useEffect(() => {
    reportRef.current?.(renderScale);
  }, [renderScale]);

  return (
    <div
      ref={rootRef}
      className={outerClassName}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        display: "flex",
        // Under `cover` the box is bigger than this element on one axis; the anchor decides
        // which end of the overflow gets clipped, and `overflow: hidden` above does the
        // clipping. Under `contain` the anchor is deliberately ignored: nothing is cropped
        // there, so it would only move the bars around, and centred bars are what every run
        // path has always drawn.
        alignItems: fit === "cover" ? anchorToFlex(cropAnchor.y) : "center",
        justifyContent: fit === "cover" ? anchorToFlex(cropAnchor.x) : "center",
        ...outerStyle
      }}
    >
      <div
        className={boxClassName}
        style={{
          position: "relative",
          flex: "none",
          width: backingWidth,
          height: backingHeight,
          overflow: "hidden",
          ...boxStyle
        }}
      >
        {children}
      </div>
    </div>
  );
}
