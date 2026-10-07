/** What a preview rebuild is built from; a change in any of it asks for a rebuild. */
export type StoryPreviewRebuildInput = {
    /** The story document, compared by identity: every edit to the story hands over a new one. */
    document: object;
    sceneId: string;
    targetId: string | null;
    /** The Game UI the stage draws (`StoryPreviewGameUiHost.gameUi`), compared by identity. */
    gameUi: object | null;
    /** Whether lines are shown in full rather than typed out; the line is compiled for it. */
    skipTyping: boolean;
};

/** An edit to the story itself, which may come in bursts as the author types. */
export const RECOMPILE_DEBOUNCE_MS = 300;
/** Pure row switches (same document, new target) rebuild sooner - they are the hot path. */
export const ROW_SWITCH_DEBOUNCE_MS = 150;
/**
 * A newer Game UI alone. Its burst of edits has already been waited out before the new Game UI was
 * built (`GAME_UI_REFRESH_DEBOUNCE_MS`), so waiting again would only add a second pause to it.
 */
export const GAME_UI_REFRESH_DELAY_MS = 0;
/** Skipping the typing turned on or off: one press, never a burst. */
export const SKIP_TYPING_TOGGLE_DELAY_MS = 0;

/** How long to wait before rebuilding the preview for this change of input. */
export function storyPreviewRebuildDelay(previous: StoryPreviewRebuildInput | null, next: StoryPreviewRebuildInput): number {
    if (!previous || previous.document !== next.document || previous.sceneId !== next.sceneId) {
        return RECOMPILE_DEBOUNCE_MS;
    }
    if (previous.targetId !== next.targetId) {
        return ROW_SWITCH_DEBOUNCE_MS;
    }
    if (previous.skipTyping !== next.skipTyping) {
        return SKIP_TYPING_TOGGLE_DELAY_MS;
    }
    if (previous.gameUi !== next.gameUi) {
        return GAME_UI_REFRESH_DELAY_MS;
    }
    return RECOMPILE_DEBOUNCE_MS;
}
