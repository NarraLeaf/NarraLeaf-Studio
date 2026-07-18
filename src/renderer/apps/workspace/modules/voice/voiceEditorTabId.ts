export type VoiceEditorTabPayload = {
    locale: string;
};

/** Stable per-locale tab id so re-opening focuses the existing tab instead of duplicating it. */
export function getVoiceEditorTabId(locale: string): string {
    return `voice:table:${locale}`;
}
