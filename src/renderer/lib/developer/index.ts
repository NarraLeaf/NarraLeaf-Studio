/**
 * Developer options: the `app.developerMode` preference and the one thing it currently does, which
 * is add a copy-the-identifier section to context menus.
 *
 * Import from here rather than from the files: the store and the menu section are two halves of one
 * feature, and a call site that reached for the store alone would be about to write its own row.
 */
export {
    DEVELOPER_MODE_DEFAULT,
    DEVELOPER_MODE_KEY,
    initDeveloperMode,
    isDeveloperModeEnabled,
    setDeveloperModeForTesting,
    useDeveloperMode,
} from "./developerMode";
export {
    appendDeveloperIdSection,
    developerCopyIdRowId,
    DEVELOPER_MENU_ROW_IDS,
    DEVELOPER_MENU_SEPARATOR_ID,
} from "./developerMenuSection";
export type {
    DeveloperIdEntry,
    DeveloperIdKind,
    DeveloperMenuSectionOptions,
} from "./developerMenuSection";
