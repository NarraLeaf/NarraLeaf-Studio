import React, { useState, useEffect } from "react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { ActionDropdown } from "../ui/ActionDropdown";
import { ActionDefinition } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusContext } from "@/lib/workspace/services/ui";
import { getActionGroupItems, getVisibleActionMenuItems, isActionVisible } from "../ui/actionMenuModel";
import { isActionFrozenOut, resolveFrozenActionDisabled } from "../ui/freezeActionPolicy";
import { RunControl } from "../../modules/actions/RunControl";
import { useWorkspaceFrozen } from "../../hooks/useWorkspaceFrozen";
import { useTranslation } from "@/lib/i18n";
import { WorkspaceMenuAction } from "@shared/types/menu";

/**
 * Registered actions the Run split-button draws itself, so this bar must not draw them a second time.
 *
 * Currently just Production Build, folded into the Run dropdown to free the room version control
 * needed in the title bar. A table of ids here rather than a flag on the
 * definition, for `freezeActionPolicy`'s reason: the decision is Studio's, and a registrant - a
 * plugin above all - has no business declaring that some other control renders it.
 *
 * Skipped, never unregistered. The macOS Dev ▸ Build menu item resolves the id through the action
 * registry, and so do the command palette and the freeze policy; dropping the registration would have
 * broken all three, the first of them only on macOS.
 */
const ACTIONS_OWNED_BY_RUN_CONTROL: ReadonlySet<string> = new Set<string>([WorkspaceMenuAction.Build]);

interface ActionBarProps {
    /**
     * Drop every dropdown menu, keeping only the standalone icon buttons. Used on macOS, where
     * the menus live on the system menu bar instead (see `useNativeMenuSync`).
     */
    hideAllGroups?: boolean;
}

/**
 * Action bar component
 * Displays dynamically registered actions in the top-left area
 * Filters actions based on focus context and when conditions
 *
 * The Run split-button ({@link RunControl}) is rendered first, with the standalone registry actions
 * (plugin actions) packed right beside it, then — off macOS — the File/Help dropdowns. Production
 * Build is inside the Run button's own dropdown rather than beside it, so the run/build controls read
 * as one thing and the title bar has room for the project switcher, which carries version control in
 * its menu; see {@link ACTIONS_OWNED_BY_RUN_CONTROL}.
 *
 * While the workspace is frozen the standalone actions render as usual but disabled, and which ones
 * escape that is decided by {@link resolveFrozenActionDisabled} - a table in Studio's source, never a
 * flag a registrant could set. See `../ui/freezeActionPolicy`.
 */
export function ActionBar({ hideAllGroups = false }: ActionBarProps) {
    const { t } = useTranslation();
    const { actions, actionGroups } = useRegistry();
    const { workspace, context } = useWorkspace();
    const frozen = useWorkspaceFrozen();
    const [focusContext, setFocusContext] = useState<FocusContext | null>(null);

    // Subscribe to focus changes
    useEffect(() => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        setFocusContext(uiService.focus.getFocus());

        return uiService.focus.onFocusChange((newContext) => {
            setFocusContext(newContext);
        });
    }, [context]);

    // Filter visible actions that are not part of any group
    const standaloneActions = actions.filter(
        (action) => !action.group
            && !ACTIONS_OWNED_BY_RUN_CONTROL.has(action.id)
            && isActionVisible(action, focusContext),
    );
    const visibleActionGroups = hideAllGroups
        ? []
        : actionGroups.filter((group) => getVisibleActionMenuItems(getActionGroupItems(group), focusContext).length > 0);

    const handleActionClick = (action: ActionDefinition) => {
        if (!workspace) {
            console.warn("[ActionBar] Unhandled action click: workspace is not initialized");
            return;
        }
        action.onClick(workspace);
    };

    return (
        <div className="flex items-center gap-0.5">
            <RunControl />

            {/* Standalone actions (Build, plugin actions) sit immediately right of the Run button */}
            {standaloneActions.map((action) => {
                // Computed for the render only; the registered object is left exactly as it was, so
                // thawing restores it without anyone having to remember what it used to be.
                const frozenOut = isActionFrozenOut(action, frozen);
                const disabled = resolveFrozenActionDisabled(action, frozen);
                const stateClasses = disabled
                    ? "text-fg-subtle cursor-not-allowed"
                    : "text-fg-muted hover:bg-fill hover:text-fg";
                const resolvedLabel = action.labelKey ? t(action.labelKey) : action.label;
                const resolvedTooltip = action.tooltipKey ? t(action.tooltipKey) : action.tooltip;
                const label = resolvedTooltip || resolvedLabel;
                // The freeze reason takes the tooltip, because an icon button that is off for no
                // stated reason reads as a bug; `aria-label` keeps naming the action itself.
                const title = frozenOut ? t("workspace.shell.freeze.unavailable") : label;

                return (
                    <button
                        key={action.id}
                        onClick={() => handleActionClick(action)}
                        disabled={disabled}
                        className={`
                            h-8 px-2 rounded-md flex items-center gap-1.5 text-sm transition-colors cursor-default relative
                            ${stateClasses}
                        `}
                        title={title}
                        aria-label={label}
                    >
                        {action.icon && <span className="w-4 h-4">{action.icon}</span>}
                        {resolvedLabel && <span>{String(resolvedLabel)}</span>}
                        {action.badge && (
                            <span className="absolute -top-1 -right-1 bg-danger text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                                {action.badge}
                            </span>
                        )}
                    </button>
                );
            })}

            {/* Group dropdowns (File/Help off macOS) trail the run/build cluster */}
            {visibleActionGroups.map((group) => (
                <ActionDropdown key={group.id} group={group} />
            ))}
        </div>
    );
}
