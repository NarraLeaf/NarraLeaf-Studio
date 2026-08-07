import { DEFAULT_APP_SURFACE_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { InterpolationParams, TranslationKey } from "@shared/i18n";

/**
 * What to call a surface in a sentence: "Page", "Game UI", or the main page's own name.
 *
 * The interface has no word that covers both kinds - an author knows Pages and Game UIs, never
 * "surfaces" - so every string about one interpolates this rather than naming a type. Lifted out of
 * `UISurfacesPanel`, which had the only copy, when the surface editor's canvas menu needed the same
 * word for the same surface.
 *
 * Takes its translator as an argument so both callers can pass what they already hold: the panel's
 * `t` from `useTranslation`, and the imperative `translate` from a menu built inside an event
 * handler.
 */
export function getSurfaceDisplayLabel(
    surface: UISurface,
    t: (key: TranslationKey, params?: InterpolationParams) => string,
): string {
    if (surface.id === MAIN_APP_SURFACE_ID) {
        return DEFAULT_APP_SURFACE_NAME;
    }
    return surface.kind === "appSurface" ? t("uiEditor.surfaceKind.page") : t("uiEditor.surfaceKind.gameUi");
}
