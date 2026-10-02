import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import { isEntrySurface } from "@shared/types/ui-editor/entrySurface";
import type { InterpolationParams, TranslationKey } from "@shared/i18n";

/** What a label needs to know about the document: which page is the entry. */
type EntryDocument = Pick<UIDocument, "surfaces" | "entrySurfaceId"> | null | undefined;

/**
 * What to call a surface in a sentence: "Page", "Game UI", or "Entry Page".
 *
 * The interface has no word that covers both kinds - an author knows Pages and Game UIs, never
 * "surfaces" - so every string about one interpolates this rather than naming a type. Lifted out of
 * `UISurfacesPanel`, which had the only copy, when the surface editor's canvas menu needed the same
 * word for the same surface.
 *
 * The entry page is named as the entry page, which is what sets it apart from every other page on
 * the list - and why its menu has no Delete. Read from the document, because which page that is
 * moves when the author makes another page the entry.
 *
 * Takes its translator as an argument so both callers can pass what they already hold: the panel's
 * `t` from `useTranslation`, and the imperative `translate` from a menu built inside an event
 * handler.
 */
export function getSurfaceDisplayLabel(
    surface: UISurface,
    document: EntryDocument,
    t: (key: TranslationKey, params?: InterpolationParams) => string,
): string {
    if (isEntrySurface(document, surface.id)) {
        return t("dialogs.noun.entryPage");
    }
    return surface.kind === "appSurface" ? t("uiEditor.surfaceKind.page") : t("uiEditor.surfaceKind.gameUi");
}

/**
 * The same word again, for the rename dialog - which interpolates its noun itself, from a
 * `dialogs.noun.*` key, so it is handed the key rather than a translated string.
 */
export function getSurfaceRenameNoun(surface: UISurface, document: EntryDocument): string {
    if (isEntrySurface(document, surface.id)) {
        return "entryPage";
    }
    return surface.kind === "appSurface" ? "page" : "gameUi";
}
