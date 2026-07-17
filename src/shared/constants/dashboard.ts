import { stableProjectKeyToken } from "@shared/utils/stableKeyHash";

/**
 * Whether the dashboard opens with a workspace is a per-project choice: one project may be a daily
 * driver you want the numbers for, another a library you only dip into.
 *
 * Stored in userData rather than the `.nlproj` for the same reason the statistics are — this is a
 * personal habit, and a version-controlled copy would let one author's preference override their
 * teammates' on every pull.
 */

/**
 * Default applied to any project the author has not decided about yet, including every new one.
 * This is the key the Settings window exposes.
 */
export const DASHBOARD_OPEN_DEFAULT_KEY = "dashboard.openOnWorkspaceOpen";

/** Per-project override; absent until the author touches the dashboard's own toggle. */
const DASHBOARD_OPEN_PROJECT_KEY_PREFIX = "dashboard.openOnWorkspaceOpen.project";

export function getDashboardOpenProjectKey(projectRef: {
    projectPath: string;
    projectIdentifier?: string | null;
}): string {
    return `${DASHBOARD_OPEN_PROJECT_KEY_PREFIX}.${stableProjectKeyToken(projectRef)}`;
}

/**
 * Resolve whether the dashboard should open, given this project's stored override (if any) and the
 * global default. Kept in one place so the dashboard's toggle and the workspace's open path can
 * never disagree about precedence.
 */
export function resolveDashboardOpen(projectValue: unknown, defaultValue: unknown): boolean {
    if (typeof projectValue === "boolean") {
        return projectValue;
    }
    return defaultValue !== false;
}
