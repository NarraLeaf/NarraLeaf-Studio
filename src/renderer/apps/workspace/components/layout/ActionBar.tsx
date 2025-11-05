import React, { useState, useEffect } from "react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { ActionDropdown } from "../ui/ActionDropdown";
import { ActionDefinition } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusContext } from "@/lib/workspace/services/ui";

/**
 * Action bar component
 * Displays dynamically registered actions in the top-left area
 * Filters actions based on focus context and when conditions
 */
export function ActionBar() {
    const { actions, actionGroups } = useRegistry();
    const { context } = useWorkspace();
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

    // Check if an action should be visible based on when condition
    const shouldShowAction = (action: ActionDefinition): boolean => {
        if (action.visible === false) return false;
        if (!action.when || !focusContext) return true;
        return action.when(focusContext);
    };

    // Filter visible actions that are not part of any group
    const standaloneActions = actions.filter((action) => !action.group && shouldShowAction(action));
    const visibleActionGroups = actionGroups.filter((group) => {
        const items = (group.items ?? group.actions) as (ActionDefinition | { items: any[]; })[];
        return hasVisible(items, focusContext);
    });

    if (standaloneActions.length === 0 && visibleActionGroups.length === 0) {
        return <div className="flex items-center gap-1" />;
    }

    return (
        <div className="flex items-center gap-0.5">
            {/* Render action groups first */}
            {visibleActionGroups.map((group) => (
                <ActionDropdown key={group.id} group={group} />
            ))}

            {/* Render standalone actions */}
            {standaloneActions.map((action) => (
                <button
                    key={action.id}
                    onClick={action.onClick}
                    disabled={action.disabled}
                    className={`
                        h-8 px-2 rounded-md flex items-center gap-1.5 text-sm transition-colors cursor-default relative
                        ${
                            action.disabled
                                ? "text-gray-500 cursor-not-allowed"
                                : "text-gray-300 hover:bg-white/10 hover:text-white"
                        }
                    `}
                    title={action.tooltip || action.label}
                    aria-label={action.label}
                >
                    {action.icon && <span className="w-4 h-4">{action.icon}</span>}
                    {action.label && <span>{action.label}</span>}
                    {action.badge && (
                        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                            {action.badge}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
}

/**
 * Check if any items in the array should be visible based on when conditions
 */
function hasVisible(items: (ActionDefinition | { items: any[] })[], focusContext: FocusContext | null): boolean {
    for (const it of items) {
        if ((it as ActionDefinition).onClick) {
            const action = it as ActionDefinition;
            // Check visible flag
            if (action.visible === false) continue;
            // Check when condition
            if (action.when && focusContext && !action.when(focusContext)) continue;
            return true;
        } else {
            const submenu = it as { items: any[] };
            if (submenu.items && submenu.items.length > 0 && hasVisible(submenu.items as any, focusContext)) return true;
        }
    }
    return false;
}

