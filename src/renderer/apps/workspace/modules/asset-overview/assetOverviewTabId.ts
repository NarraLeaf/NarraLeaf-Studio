/**
 * The overview is a singleton tab: one project has one asset library, so a second copy of the page
 * would only be a second reading of the same numbers. A constant id is what makes repeat opens
 * focus the existing tab instead of stacking duplicates.
 */
export const ASSET_OVERVIEW_TAB_ID = "narraleaf-studio:asset-overview";
