import { useEffect } from "react";
import { formatRecentProjectLabel } from "@shared/utils/recentProject";
import { useRegistry } from "../registry";
import type { ActionDefinition, ActionMenuItem, ActionSubmenu } from "../registry/types";
import { fileActionGroup } from "../modules/actions";
import { useOpenRecentProject, useRecentProjects } from "./useRecentProjects";

const FILE_GROUP_ID = fileActionGroup.id;
const OPEN_ACTION_ID = "narraleaf-studio:file-open";
const OPEN_RECENT_SUBMENU_ID = "narraleaf-studio:file-open-recent";

/**
 * Owns the File action group so its "Open Recent" submenu can track the history live.
 *
 * The group is registered here rather than statically (it is left out of `globalActionGroups`)
 * so there is a single writer: a static registration plus a live one would race for the same id.
 * Its New/Open/Export/Close items are taken straight from `fileActionGroup`, so their behaviour
 * stays defined in one place; only the recent submenu is assembled here.
 *
 * This drives the in-app File dropdown on Windows and Linux. macOS builds its File menu natively
 * (the group is `menuSlot: "none"`), so there the recent list comes from the native menu instead
 * and this only keeps the actions dispatchable.
 */
export function useFileMenu(): void {
    const { registerActionGroup, unregisterActionGroup } = useRegistry();
    const recentProjects = useRecentProjects();
    const openRecentProject = useOpenRecentProject();

    useEffect(() => {
        const recentItems: ActionMenuItem[] = recentProjects.length === 0
            ? [{
                id: `${OPEN_RECENT_SUBMENU_ID}:empty`,
                labelKey: "menu.file.noRecent",
                disabled: true,
                onClick: () => {},
            }]
            : recentProjects.map<ActionDefinition>(project => ({
                id: `${OPEN_RECENT_SUBMENU_ID}:${project.path}`,
                label: formatRecentProjectLabel(project),
                onClick: () => { void openRecentProject(project.path); },
            }));

        const openRecentSubmenu: ActionSubmenu = {
            id: OPEN_RECENT_SUBMENU_ID,
            label: "Open Recent",
            labelKey: "menu.file.openRecent",
            items: recentItems,
        };

        // Splice the recent submenu in right after "Open", keeping the group's own ordering.
        const items: ActionMenuItem[] = [];
        for (const action of fileActionGroup.actions ?? []) {
            items.push(action as ActionMenuItem);
            if ("id" in action && action.id === OPEN_ACTION_ID) {
                items.push(openRecentSubmenu);
            }
        }

        registerActionGroup({
            id: FILE_GROUP_ID,
            label: fileActionGroup.label,
            labelKey: fileActionGroup.labelKey,
            icon: fileActionGroup.icon,
            order: fileActionGroup.order,
            menuSlot: fileActionGroup.menuSlot,
            items,
        });
    }, [recentProjects, openRecentProject, registerActionGroup]);

    useEffect(() => {
        return () => unregisterActionGroup(FILE_GROUP_ID);
    }, [unregisterActionGroup]);
}
