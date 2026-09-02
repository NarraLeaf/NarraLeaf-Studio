import { normalizeProjectPath } from "@shared/utils/recentProject";

/**
 * Whether a preview of this project seals its content the way a protected production build does.
 *
 * The third of the per-project run habits, after `runVariant.ts` and `runDlc.ts`, and it follows
 * them in every structural decision: a machine-level setting bucketed by `normalizeProjectPath`,
 * read here by the main process rather than carried on the launch request, never written into
 * `.nlproj`, and no IPC surface changes. See `runVariant.ts` for why the bucket key is a comparison
 * key and nothing else.
 *
 * # Off, until the author says otherwise
 *
 * A store is written whole - there is no way to replace one entry, and a story edit changes the
 * pack - so a preview that seals re-seals every asset on every launch, for an artifact nobody
 * receives: measured at around six seconds hot on a real-size project against under two loose. The
 * everyday preview therefore runs loose files even where protection is on, and this switch is how an
 * author rehearses the shipped path before a release rather than meeting after shipping what only
 * the sealed form does differently: an asset with no file path, a runtime file outside the store's
 * allowed names, a pack with no manifest to look up.
 *
 * Only `true` counts. Every other value - absent, a stale shape, a different project's key - is off,
 * because off is the default and the two are one state.
 *
 * Comments in English per project convention.
 */
export const PREVIEW_AS_SHIPPED_SETTINGS_KEY = "ui.previewAsShippedByProject";

/** Reader for the global settings store, so this stays testable without an app. */
export type PreviewAsShippedSettingsReader = { get(key: string): unknown };

/** Whether the next preview of `projectPath` should take the protected build's sealing path. */
export function resolvePreviewAsShipped(settings: PreviewAsShippedSettingsReader, projectPath: string): boolean {
    const stored = settings.get(PREVIEW_AS_SHIPPED_SETTINGS_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
        return false;
    }
    return (stored as Record<string, unknown>)[normalizeProjectPath(projectPath)] === true;
}
