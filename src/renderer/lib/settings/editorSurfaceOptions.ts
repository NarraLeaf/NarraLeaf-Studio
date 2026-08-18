/**
 * Single source of truth for the editor surface opacity preference.
 *
 * Shared between the settings registry (`appSettings.ts`) and the bootstrap that publishes the
 * preference as a CSS custom property (`lib/appearance`), so the bounds can never drift.
 */

/** Global-state key; also the settings-registry key. */
export const EDITOR_SURFACE_OPACITY_KEY = "editor.surfaceOpacity";

/**
 * The custom property the editor reading surfaces resolve their `--nl-surface-sunken` alpha
 * through. Published on the root element by `lib/appearance`; see `.nl-editor-surface` in
 * styles.css for the single rule that consumes it.
 */
export const EDITOR_SURFACE_OPACITY_VAR = "--nl-editor-surface-opacity";

export const EDITOR_SURFACE_OPACITY_MIN = 0;
export const EDITOR_SURFACE_OPACITY_MAX = 100;
export const EDITOR_SURFACE_OPACITY_STEP = 5;

/**
 * 100, i.e. the behaviour that shipped first and the only value that is a no-op for everyone.
 *
 * The workspace wallpaper is opt-in, and so is the seam it creates: without a wallpaper every base
 * surface is already opaque, so this setting is inert and no default other than 100 could be
 * justified to those users. With a wallpaper on, the knob is what lets the author dial the reading
 * surfaces back until the editor stops reading as a hard rectangle cut out of the picture.
 */
export const EDITOR_SURFACE_OPACITY_DEFAULT = 100;

/**
 * Percent -> CSS alpha, clamped and rounded to the declared step domain.
 *
 * Emits `"0"` and `"1"` exactly at the ends: a translucent-but-not-quite paint at 100 would leave
 * a faint wash of whatever sits behind the words, and the whole point of the top of the range is
 * that the prose is on an opaque plate.
 */
export function editorSurfaceAlpha(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return "1";
  }
  const percent = Math.min(
    EDITOR_SURFACE_OPACITY_MAX,
    Math.max(EDITOR_SURFACE_OPACITY_MIN, Math.round(numeric))
  );
  if (percent === EDITOR_SURFACE_OPACITY_MAX) {
    return "1";
  }
  if (percent === EDITOR_SURFACE_OPACITY_MIN) {
    return "0";
  }
  return String(percent / 100);
}
