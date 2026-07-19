import React, { useState, useEffect } from "react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { ActionDropdown } from "../ui/ActionDropdown";
import { ActionDefinition } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { PreviewService } from "@/lib/workspace/services/core/PreviewService";
import { FocusContext } from "@/lib/workspace/services/ui";
import type { DevModeStatus } from "@shared/types/devMode";
import type { PreviewStatus } from "@shared/types/gameRuntime";
import { getActionGroupItems, getVisibleActionMenuItems, isActionVisible } from "../ui/actionMenuModel";
import { isDevModeRuntimeActive, isPreviewRuntimeActive } from "../../modules/actions/runtimeActionStatus";
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
 */
export function ActionBar({ hideAllGroups = false }: ActionBarProps) {
    const { t } = useTranslation();
    const { actions, actionGroups } = useRegistry();
    const { workspace, context } = useWorkspace();
    const [focusContext, setFocusContext] = useState<FocusContext | null>(null);
    const [devModeStatus, setDevModeStatus] = useState<DevModeStatus>("idle");
    const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");

    // Subscribe to focus changes
    useEffect(() => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        setFocusContext(uiService.focus.getFocus());

        return uiService.focus.onFocusChange((newContext) => {
            setFocusContext(newContext);
        });
    }, [context]);

    useEffect(() => {
        if (!context) {
            return;
        }
        const devModeService = context.services.get<DevModeService>(Services.DevMode);
        setDevModeStatus(devModeService.getStatus());
        const unsub = devModeService.onStatusChanged(setDevModeStatus);
        return () => {
            unsub();
        };
    }, [context]);

    useEffect(() => {
        if (!context) {
            return;
        }
        const previewService = context.services.get<PreviewService>(Services.Preview);
        setPreviewStatus(previewService.getStatus());
        const unsub = previewService.onStatusChanged(setPreviewStatus);
        return () => {
            unsub();
        };
    }, [context]);

    // Filter visible actions that are not part of any group
    const standaloneActions = actions.filter((action) => !action.group && isActionVisible(action, focusContext));
    const visibleActionGroups = hideAllGroups
        ? []
        : actionGroups.filter((group) => getVisibleActionMenuItems(getActionGroupItems(group), focusContext).length > 0);

    if (standaloneActions.length === 0 && visibleActionGroups.length === 0) {
        return <div className="flex items-center gap-1" />;
    }

    const handleActionClick = (action: ActionDefinition) => {
        if (!workspace) {
            console.warn("[ActionBar] Unhandled action click: workspace is not initialized");
            return;
        }
        action.onClick(workspace);
    };

    return (
        <div className="flex items-center gap-0.5">
            {/* Render action groups first */}
            {visibleActionGroups.map((group) => (
                <ActionDropdown key={group.id} group={group} />
            ))}

            {/* Render standalone actions */}
            {standaloneActions.map((action) => {
                const isDevModeAction = action.id === "narraleaf-studio:dev-mode";
                const isPreviewAction = action.id === "narraleaf-studio:preview";
                const isDevModeActive =
                    isDevModeAction && isDevModeRuntimeActive(devModeStatus);
                const isPreviewActive =
                    isPreviewAction && isPreviewRuntimeActive(previewStatus);
                const isRuntimeActionActive = isDevModeActive || isPreviewActive;
                const stateClasses = action.disabled
                    ? "text-fg-subtle cursor-not-allowed"
                    : isRuntimeActionActive
                        ? "bg-danger text-white hover:bg-danger/80 hover:text-white"
                        : "text-fg-muted hover:bg-fill hover:text-fg";
                const resolvedLabel = action.labelKey ? t(action.labelKey) : action.label;
                const resolvedTooltip = action.tooltipKey ? t(action.tooltipKey) : action.tooltip;
                const title = isRuntimeActionActive
                    ? isDevModeAction
                        ? t("workspace.shell.stopDevMode")
                        : t("workspace.shell.stopPreview")
                    : resolvedTooltip || resolvedLabel;

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
                        aria-pressed={isRuntimeActionActive || undefined}
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
        </div>
    );
}
