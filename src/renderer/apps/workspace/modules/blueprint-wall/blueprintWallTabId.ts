/**
 * The Blueprint Overview is a singleton tab, so a constant id keeps a second open from stacking a
 * duplicate. Its own file because session restore imports the id without wanting the component.
 */
export const BLUEPRINT_WALL_TAB_ID = "narraleaf-studio:blueprint-overview";
