export type VoiceEditorTabPayload = {
    locale: string;
    /**
     * A line to bring on screen and mark - where its take is linked. `storyId` names the story the line
     * is in; without it the table looks the line up itself. `token` comes from `nextTableRevealToken`,
     * so asking for the same line twice is two requests.
     */
    reveal?: { unitId: string; storyId?: string; token: number };
};

/** Stable per-locale tab id so re-opening focuses the existing tab instead of duplicating it. */
export function getVoiceEditorTabId(locale: string): string {
    return `voice:table:${locale}`;
}
