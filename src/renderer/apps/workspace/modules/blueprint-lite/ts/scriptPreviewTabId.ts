/**
 * Tab id for the read-only preview of one of the project's scripts.
 *
 * Its own module for the same reason the text editor's is: the open path and the session serializer
 * both need the id, and neither may import the component - doing so would pull Monaco into the
 * workspace's startup path whether or not a script is ever opened.
 */
export const SCRIPT_PREVIEW_TAB_PREFIX = "narraleaf-studio:blueprint:script-";

export function getScriptPreviewTabId(scriptRef: string): string {
    return `${SCRIPT_PREVIEW_TAB_PREFIX}${scriptRef}`;
}

export type ScriptPreviewTabPayload = {
    /** Project-relative, always under `scripts/`. */
    scriptRef: string;
};
