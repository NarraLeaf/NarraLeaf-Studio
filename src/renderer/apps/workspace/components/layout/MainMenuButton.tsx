import React, { useEffect, useMemo, useState } from "react";
import { Menu } from "lucide-react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { ActionDropdown } from "../ui/ActionDropdown";
import { ActionGroup, ActionMenuItem } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusContext } from "@/lib/workspace/services/ui";
import { buildMainMenuSubmenus } from "./mainMenuModel";
import { useWorkspaceFrozen } from "../../hooks/useWorkspaceFrozen";
import { useTranslation } from "@/lib/i18n";

/** Identity of the synthetic group the hamburger opens. Not registered; nothing else may name it. */
const MAIN_MENU_GROUP_ID = "narraleaf-studio:main-menu";

/**
 * Every title-bar menu behind one hamburger button - the `hamburger` half of `ui.menuBar.mode`.
 *
 * Rendered instead of the ActionBar's dropdowns (see `WorkspaceLayout`), never alongside them: the
 * point of the mode is that the menus stop naming themselves along the bar. It sits at the far left,
 * before the project name, because a collapsed menu bar is read as the window's own menu rather than
 * as one more toolbar button.
 *
 * The menu itself is an {@link ActionDropdown} over a group assembled here: each registered group
 * becomes one submenu, in the order the bar would have drawn them. So the rows, their shortcuts,
 * their keyboard navigation and their submenus are the same code in both modes rather than a second
 * menu implementation that could drift from the first.
 *
 * **The freeze is applied here, per group, and the dropdown is told not to apply it again**
 * (`preFrozen`). A frozen workspace exempts File, Help and the image preview's zoom controls (see
 * `freezeActionPolicy`), and that decision is keyed by the group's own id - which the assembled
 * group no longer has. Left to the dropdown, one id would answer for all of them and a frozen
 * window would lose the File menu it is escaped through.
 */
export function MainMenuButton() {
    const { t } = useTranslation();
    const { actionGroups } = useRegistry();
    const { context } = useWorkspace();
    const frozen = useWorkspaceFrozen();
    const [focusContext, setFocusContext] = useState<FocusContext | null>(null);

    // The rows a group offers depend on what is focused, exactly as they do in the bar.
    useEffect(() => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        setFocusContext(uiService.focus.getFocus());

        return uiService.focus.onFocusChange((newContext) => {
            setFocusContext(newContext);
        });
    }, [context]);

    const submenus = useMemo<ActionMenuItem[]>(
        () => buildMainMenuSubmenus(actionGroups, focusContext, frozen, t("workspace.shell.freeze.unavailable")),
        [actionGroups, focusContext, frozen, t],
    );

    const group = useMemo<ActionGroup>(() => ({
        id: MAIN_MENU_GROUP_ID,
        label: t("workspace.shell.mainMenu.label"),
        icon: <Menu className="w-4 h-4" />,
        items: submenus,
    }), [submenus, t]);

    // An empty menu renders nothing at all: ActionDropdown already drops a group with no visible
    // rows, and a hamburger that opens on nothing would be worse than the gap.
    return <ActionDropdown group={group} iconOnly preFrozen />;
}
