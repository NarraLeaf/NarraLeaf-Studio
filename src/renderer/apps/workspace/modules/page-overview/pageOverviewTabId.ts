/**
 * The Page Overview is a singleton tab: one per project, switching pages inside it rather than
 * stacking a tab per page. Its own file because session restore imports the id and the payload
 * without wanting the component.
 */
export const PAGE_OVERVIEW_TAB_ID = "narraleaf-studio:page-overview";

export type PageOverviewMode = "current" | "all";

export type PageOverviewTabPayload = {
    /** The page shown in "This page", and the one "All pages" scrolls to first. */
    surfaceId?: string;
    mode?: PageOverviewMode;
};

/** A payload read back from a saved session, keeping only what still has the right shape. */
export function readPageOverviewPayload(value: unknown): PageOverviewTabPayload {
    if (!value || typeof value !== "object") {
        return {};
    }
    const record = value as Record<string, unknown>;
    return {
        ...(typeof record.surfaceId === "string" && record.surfaceId ? { surfaceId: record.surfaceId } : {}),
        ...(record.mode === "current" || record.mode === "all" ? { mode: record.mode } : {}),
    };
}
