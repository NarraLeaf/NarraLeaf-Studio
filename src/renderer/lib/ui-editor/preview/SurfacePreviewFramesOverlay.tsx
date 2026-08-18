import { useMemo } from "react";
import type { SurfacePreviewSize } from "./surfacePreviewFrames";
import {
  computeSafeAreaFrameById,
  computeScreenRatioFrameById,
  computeScreenRatioStrips,
  computeUnsafeBands
} from "./surfacePreviewFrames";
import type { SafeAreaMobileOrientation, SurfacePreviewFit } from "./surfacePreviewFrames";

export type SurfacePreviewFramesOverlayProps = {
  /** Surface design size; the design rect is `{x: 0, y: 0, ...designSize}`. */
  designSize: SurfacePreviewSize;
  /** Aspect preset id, `null` = the screen-ratio frame is off. */
  aspectId: string | null;
  /** Safe-area device preset id, `null` = the safe-area frame is off. */
  safeAreaId: string | null;
  /** The project's `app.mobile.orientation`; decides which edge the device inset lands on. */
  mobileOrientation?: SafeAreaMobileOrientation | null;
  /** The project's `app.mobile.fit`. Under `cover` the screen frame marks a crop, not bars. */
  stageFit?: SurfacePreviewFit;
  /** Canvas CSS scale, so hairlines can be kept at 1 device px. */
  viewportScale: number;
};

/**
 * Aspect-ratio + safe-area preview frames for the UI Surface canvas.
 *
 * **Mount inside the transformed canvas node** — the div carrying `transform: translate(...)
 * scale(...)` with `transformOrigin: top left`, whose local origin is surface `(0,0)`. Everything
 * here is positioned in raw design pixels; zoom and pan come free from that parent.
 *
 * The engine letterboxes on every run path, so these frames never show "what gets cut off":
 * the screen-ratio frame shows where the bars land, and the safe-area frame shows how far a
 * device's notch / home indicator reaches into the content *after* the bars absorbed part of it.
 *
 * The safe area is drawn as **filled bands over the unsafe edges**, not only as an outline. On a
 * 16:9 design every preset here resolves to left = right = top = 0 and a bottom inset of ~58-63
 * design px, so an outline alone puts three of its four edges exactly on the surface boundary and
 * the whole layer reads as "my click did nothing". The bands are the part that is visible at a
 * glance; the dashed outline stays as the precise boundary.
 *
 * Text belongs outside this component — everything here lives inside the zoomed canvas node, so a
 * label would scale with the zoom. The preset name and the inset numbers are rendered unscaled by
 * `SurfacePreviewFramesReadout`.
 */
export function SurfacePreviewFramesOverlay(props: SurfacePreviewFramesOverlayProps) {
  const { designSize, aspectId, safeAreaId, mobileOrientation, stageFit, viewportScale } = props;

  // The parent is CSS-scaled, so a 1px stroke authored in design units renders at `scale` px.
  // Divide it back out to keep every hairline at one device pixel at any zoom. Blink derives a
  // dashed border's dash length from its border-width, so the dash pattern scales with it too.
  const hairline = useMemo(() => {
    const scale = Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1;
    return 1 / scale;
  }, [viewportScale]);

  const screenFrame = useMemo(
    () => computeScreenRatioFrameById(designSize, aspectId, stageFit),
    [designSize, aspectId, stageFit]
  );
  const safeFrame = useMemo(
    () => computeSafeAreaFrameById(designSize, safeAreaId, mobileOrientation, stageFit),
    [designSize, safeAreaId, mobileOrientation, stageFit]
  );
  const unsafeBands = useMemo(
    () => computeUnsafeBands(designSize, safeFrame),
    [designSize, safeFrame]
  );

  if (!screenFrame && !safeFrame) {
    return null;
  }

  // Where the design rect and the player's screen disagree: bars outside it under `contain`,
  // cropped-away design inside it under `cover`. One helper for both, so the two readings cannot
  // drift apart — and under `cover` the strips sit ON the surface, which is the point.
  const screenRect = screenFrame?.screenRect;
  const strips = computeScreenRatioStrips(designSize, screenFrame);

  return (
    <div className="pointer-events-none absolute inset-0 z-[4]">
      {strips.map((strip, i) => (
        <div
          key={`preview-strip-${i}`}
          // A crop is a loss, a bar is not — the cropped strips read as danger, the bars
          // stay the quiet fill they have always been.
          className={`absolute ${screenFrame?.cropped ? "bg-danger/20" : "bg-fill-subtle"}`}
          style={{ left: strip.x, top: strip.y, width: strip.width, height: strip.height }}
        />
      ))}
      {screenRect ? (
        <div
          className="absolute border-edge-strong"
          style={{
            left: screenRect.x,
            top: screenRect.y,
            width: screenRect.width,
            height: screenRect.height,
            borderWidth: hairline
          }}
        />
      ) : null}
      {unsafeBands.map((band, i) => (
        <div
          key={`unsafe-band-${i}`}
          className="absolute bg-warning/20"
          style={{ left: band.x, top: band.y, width: band.width, height: band.height }}
        />
      ))}
      {safeFrame ? (
        // When `fullySafe` the safe rect coincides with the design rect — still drawn, that
        // is the informative answer ("no risk on this device"), not a case to hide.
        <div
          className="absolute border-dashed border-warning/50"
          style={{
            left: safeFrame.safeRect.x,
            top: safeFrame.safeRect.y,
            width: safeFrame.safeRect.width,
            height: safeFrame.safeRect.height,
            borderWidth: hairline
          }}
        />
      ) : null}
    </div>
  );
}
