import type { ActionGroup, ActionSubmenu } from "../../registry/types";
import type { FocusContext } from "@/lib/workspace/services/ui";
import { getActionGroupItems, getVisibleActionMenuItems } from "../ui/actionMenuModel";
import { applyFreezeToActionMenuItems, isFreezeExemptActionGroup } from "../ui/freezeActionPolicy";

/**
 * The registered title-bar menus, folded into the submenus of one menu - what the hamburger opens.
 *
 * Separate from the component so the two things that are easy to get wrong here can be tested
 * without a workspace: the order the groups end up in, and which of them a frozen workspace turns
 * off. See {@link MainMenuButton} for why the freeze is decided here rather than in the dropdown.
 */
export function buildMainMenuSubmenus(
    groups: readonly ActionGroup[],
    focusContext: FocusContext | null,
    frozen: boolean,
    frozenReason: string,
): ActionSubmenu[] {
    return groups.flatMap<ActionSubmenu>((group, index) => {
        const visible = getVisibleActionMenuItems(getActionGroupItems(group), focusContext);
        // A group with nothing to show is left out entirely rather than offered as an empty row.
        if (visible.length === 0) {
            return [];
        }
        // Per group, by its own id: the exemptions (File, Help, the image preview's zoom controls)
        // are what keeps a frozen window escapable, and the assembled group has no id to claim them
        // with. See `../ui/freezeActionPolicy`.
        const frozenOut = frozen && !isFreezeExemptActionGroup(group.id);
        return [{
            id: group.id,
            label: group.label,
            labelKey: group.labelKey,
            icon: group.icon,
            items: applyFreezeToActionMenuItems(visible, frozenOut),
            // Registration order, restated as an explicit rank: the registry sorts an order-less
            // group last, while a menu sorts an order-less row first (`byActionMenuOrder`), so
            // passing the groups through unranked would stand them on their heads.
            order: index,
            // Only the groups the freeze actually switched off say so. Left unset, the rows of an
            // exempt group that are disabled for their own reasons would be given this one.
            disabledReason: frozenOut ? frozenReason : undefined,
        }];
    });
}
