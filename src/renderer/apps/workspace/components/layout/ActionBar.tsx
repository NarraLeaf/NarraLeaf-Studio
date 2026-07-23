import React, { useState, useEffect } from "react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { ActionDropdown } from "../ui/ActionDropdown";
import { ActionDefinition } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusContext } from "@/lib/workspace/services/ui";
import { getActionGroupItems, getVisibleActionMenuItems, isActionVisible } from "../ui/actionMenuModel";
import { RunControl } from "../../modules/actions/RunControl";
import { useTranslation } from "@/lib/i18n";

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
 * (the Build icon, plugin actions) packed right beside it, then — off macOS — the File/Help
 * dropdowns. Keeping Build adjacent to Run makes the run/build controls read as one cluster.
 */
export function ActionBar({ hideAllGroups = false }: ActionBarProps) {
    const { t } = useTranslation();
    const { actions, actionGroups } = useRegistry();
    const { workspace, context } = useWorkspace();
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
    const standaloneActions = actions.filter((action) => !action.group && isActionVisible(action, focusContext));
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
                const stateClasses = action.disabled
                    ? "text-fg-subtle cursor-not-allowed"
                    : "text-fg-muted hover:bg-fill hover:text-fg";
                const resolvedLabel = action.labelKey ? t(action.labelKey) : action.label;
                const resolvedTooltip = action.tooltipKey ? t(action.tooltipKey) : action.tooltip;
                const title = resolvedTooltip || resolvedLabel;

                return (
                    <button
                        key={action.id}
                        onClick={() => handleActionClick(action)}
                        disabled={action.disabled}
                        className={`
                            h-8 px-2 rounded-md flex items-center gap-1.5 text-sm transition-colors cursor-default relative
                            ${stateClasses}
                        `}
                        title={title}
                        aria-label={title}
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
