/**
 * Group ids the macOS menu bar builds itself (File, Help), rather than mirroring from the
 * action registry. They are excluded from the menu sync so the native bar does not end up with
 * two copies of the same menu.
 */
export const NATIVE_MENU_OWNED_GROUP_IDS: string[] = [
    "narraleaf-studio:file",
    "narraleaf-studio:help",
];
