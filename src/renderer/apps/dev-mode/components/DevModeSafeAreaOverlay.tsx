import { useMemo } from "react";
import {
  computeSafeAreaFrameById,
  computeUnsafeBands,
  type SafeAreaMobileOrientation,
  type SurfacePreviewSize
} from "@/lib/ui-editor/preview/surfacePreviewFrames";

export type DevModeSafeAreaOverlayProps = {
  /** The design size the stage is laid out in — the space the frame geometry is computed in. */
  designSize: SurfacePreviewSize;
  /** Device preset id, `null` = the overlay is off. */
  safeAreaId: string | null;
  /** The project's `app.mobile.orientation`, forwarded on the launch entry. */
  mobileOrientation?: SafeAreaMobileOrientation | null;
};

/**
 * The UI editor's safe-area frame, drawn over the running game.
 *
 * **Mount inside `StageViewportFrame`'s box**, which is exactly `designSize × renderScale` — so
 * everything here is positioned in *percentages* of the design size and needs no measuring: the
 * letterbox bars are outside the box and the frame tracks any window resize for free.
 *
 * Same reading as on the canvas (see `SurfacePreviewFramesOverlay`): the filled bands are the parts
 * a device's notch / home indicator covers, the dashed line is the boundary. It is a design aid over
 * a live game, so it is `pointer-events-none` throughout and never touches the game's own layers.
 */
export function DevModeSafeAreaOverlay({
  designSize,
  safeAreaId,
  mobileOrientation
}: DevModeSafeAreaOverlayProps) {
  const frame = useMemo(
    () => computeSafeAreaFrameById(designSize, safeAreaId, mobileOrientation),
    [designSize, safeAreaId, mobileOrientation]
  );
  const bands = useMemo(() => computeUnsafeBands(designSize, frame), [designSize, frame]);

  if (!frame) {
    return null;
  }

  const px = (value: number) => `${(value / designSize.width) * 100}%`;
  const py = (value: number) => `${(value / designSize.height) * 100}%`;

  return (
    // Above the surface layers (`z-10` inside the stage content) so the frame is not covered by
    // whatever the game happens to be drawing.
    <div className="pointer-events-none absolute inset-0 z-20">
      {bands.map((band, i) => (
        <div
          key={`devmode-unsafe-band-${i}`}
          className="absolute bg-warning/20"
          style={{
            left: px(band.x),
            top: py(band.y),
            width: px(band.width),
            height: py(band.height)
          }}
        />
      ))}
      <div
        className="absolute border border-dashed border-warning/50"
        style={{
          left: px(frame.safeRect.x),
          top: py(frame.safeRect.y),
          width: px(frame.safeRect.width),
          height: py(frame.safeRect.height)
        }}
      />
    </div>
  );
}
