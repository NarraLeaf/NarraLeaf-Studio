export type LocalizationEditorTabPayload = {
    locale: string;
};

/** Stable per-locale tab id so re-opening focuses the existing tab instead of duplicating it. */
export function getLocalizationEditorTabId(locale: string): string {
    return `localization:table:${locale}`;
}
