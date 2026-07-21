/**
 * Blank "new tab" pages are keyed by a random token so any number of them can be open at once,
 * unlike singleton tabs (welcome/dashboard) whose ids are fixed.
 */
export const NEW_TAB_ID_PREFIX = "narraleaf-studio:new-tab-";

export function getNewTabId(token: string): string {
    return `${NEW_TAB_ID_PREFIX}${token}`;
}
