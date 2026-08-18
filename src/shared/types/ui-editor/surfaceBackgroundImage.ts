/**
 * A picture behind a Surface, under everything the Surface draws.
 *
 * Deliberately narrower than the widgets' {@link import("./imageFill").ImageFill}: there is no crop
 * mode and no crop placement. Cropping a widget's fill is a direct-manipulation gesture on the
 * canvas - the element box is the frame and the handles sit on it - and a Surface has no such box to
 * grab: its frame is the whole design area, which the author is already looking through. The four
 * modes here are the ones that are a choice rather than a gesture.
 */
export type UISurfaceBackgroundFillMode = "cover" | "contain" | "stretch" | "tile";

export const UI_SURFACE_BACKGROUND_FILL_MODES: readonly UISurfaceBackgroundFillMode[] = [
  "cover",
  "contain",
  "stretch",
  "tile"
];

export const DEFAULT_UI_SURFACE_BACKGROUND_FILL_MODE: UISurfaceBackgroundFillMode = "cover";

export type UISurfaceBackgroundImage = {
  /** Image library asset id. Absent background = absent field, so this is never empty. */
  assetId: string;
  fillMode: UISurfaceBackgroundFillMode;
};

export function isUISurfaceBackgroundFillMode(
  value: unknown
): value is UISurfaceBackgroundFillMode {
  return (
    typeof value === "string" &&
    (UI_SURFACE_BACKGROUND_FILL_MODES as readonly string[]).includes(value)
  );
}

/**
 * Read a stored background image, or `null` when there is nothing to draw.
 *
 * An entry with no asset id is treated as no background rather than as a broken one: clearing the
 * picture removes the whole field, so the only way to hold a mode with no image is a document
 * written by something other than the inspector, and a blank Surface is the honest reading of it.
 * An unknown mode falls back to the default rather than dropping the image - a Surface authored in a
 * later version should still show its background here.
 */
export function normalizeUISurfaceBackgroundImage(value: unknown): UISurfaceBackgroundImage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<UISurfaceBackgroundImage>;
  const assetId = typeof record.assetId === "string" ? record.assetId.trim() : "";
  if (!assetId) {
    return null;
  }
  return {
    assetId,
    fillMode: isUISurfaceBackgroundFillMode(record.fillMode)
      ? record.fillMode
      : DEFAULT_UI_SURFACE_BACKGROUND_FILL_MODE
  };
}
