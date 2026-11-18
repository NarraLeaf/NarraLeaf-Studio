import { localizationDocumentSpec, localizationKeysSpec, voiceDocumentSpec } from "@shared/documents/specs";

/**
 * Which file one language's translation table writes, as the project-relative path the freeze policy
 * takes.
 *
 * Through the document spec rather than spelled out here, for the reason `writeFreeze` gives: a path
 * written a second time is a path that falls behind the one `LocalizationService` actually saves to.
 * If the two ever disagree, the table offers an edit the write boundary refuses.
 */
export function translationDocumentFreezeScope(locale: string): string {
    return localizationDocumentSpec.pathFor({ locale });
}

/** Which file one language's voice table writes. The translations' mirror. */
export function voiceDocumentFreezeScope(locale: string): string {
    return voiceDocumentSpec.pathFor({ locale });
}

/**
 * Which file the named-key registry writes.
 *
 * Named apart from the translations beside it because they really are two documents: one holds the
 * source texts, the other their translations, and only one of them is per language.
 */
export function localizationKeysFreezeScope(): string {
    return localizationKeysSpec.pathFor();
}
