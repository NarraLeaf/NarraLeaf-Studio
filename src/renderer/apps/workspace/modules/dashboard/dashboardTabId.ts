/**
 * The dashboard is a singleton tab: `openEditorTabInGroup` focuses an existing tab when the id
 * already exists in the group, so a constant id is what keeps repeat opens from stacking up
 * duplicates. It lives in its own file because the session restore path imports the id without
 * wanting the component.
 */
export const DASHBOARD_TAB_ID = "narraleaf-studio:dashboard";
