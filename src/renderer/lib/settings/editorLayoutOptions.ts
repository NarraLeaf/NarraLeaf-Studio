/**
 * Single source of truth for the editor-area layout preferences.
 *
 * Shared between the settings registry (`appSettings.ts`) and the consumer that applies the
 * preference (the workspace `EditorGroup` keep-alive logic) so bounds/defaults never drift.
 */

/**
 * How many editor tabs stay mounted (kept alive) at once. The active tab is always mounted;
 * up to this many most-recently-active tabs are kept mounted-but-hidden so their scroll
 * position, focus, and in-memory state survive a tab switch. Tabs beyond the cap are unmounted
 * (least-recently-active first) and cold-restore from disk when reopened.
 */
export const MAX_ACTIVE_EDITORS_MIN = 1;
export const MAX_ACTIVE_EDITORS_MAX = 32;
export const MAX_ACTIVE_EDITORS_DEFAULT = 8;

/** Clamp a raw/persisted value to the supported range, falling back to the default. */
export function clampMaxActiveEditors(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return MAX_ACTIVE_EDITORS_DEFAULT;
    }
    return Math.min(MAX_ACTIVE_EDITORS_MAX, Math.max(MAX_ACTIVE_EDITORS_MIN, Math.floor(parsed)));
}
