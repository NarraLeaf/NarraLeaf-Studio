import { useEffect, useMemo, useState } from "react";
import {
    Package,
    FileText,
    FolderOpen,
    X,
    Archive,
} from "lucide-react";
import { ModuleAction, ModuleActionGroup } from "../types";
import { cn } from "@/lib/utils/cn";
import { Workspace } from "@/lib/workspace/workspace";
import { UIService } from "@/lib/workspace/services/ui";
import { Services } from "@/lib/workspace/services/services";
import { openWelcomeTab } from "../welcome/openWelcomeTab";
import { openAboutTab } from "../about/openAboutTab";
import { getInterface } from "@/lib/app/bridge";
import { Separator } from "../../registry/types";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import { BuildService } from "@/lib/workspace/services/core/BuildService";
import type { GameBuildStatus } from "@shared/types/gameBuild";
import { useWorkspace } from "../../context";
import { openBuildDialog } from "./BuildDialog";
import { translate, translateN } from "@/lib/i18n";

/**
 * Global toolbar actions
 * These actions are always available in the top action bar
 */

/**
 * Build project action
 * Opens the production build dialog for the current project.
 *
 * Dev Mode and Preview are no longer standalone actions — the toolbar's Run split-button
 * ({@link RunControl}) owns launching and stopping both. Build keeps its own single-icon button.
 */
export const buildAction: ModuleAction = {
    id: "narraleaf-studio:build",
    icon: <BuildActionIcon />,
    tooltip: "Build project",
    tooltipKey: "actions.build.tooltip",
    onClick: (workspace: Workspace) => {
        void openBuildDialog(workspace);
    },
    order: 4,
};

function BuildActionIcon() {
    const { context } = useWorkspace();
    const [status, setStatus] = useState<GameBuildStatus>("idle");

    useEffect(() => {
        if (!context) {
            return;
        }
        const buildService = context.services.get<BuildService>(Services.Build);
        const uiService = context.services.get<UIService>(Services.UI);
        let previous = buildService.getStatus();
        setStatus(previous);
        const unsub = buildService.onStateChanged(state => {
            setStatus(state.status);
            if (state.status !== previous) {
                if (state.status === "done") {
                    uiService.showNotification(translate("build.toast.done"), "success");
                } else if (state.status === "error") {
                    uiService.showNotification(state.error ?? translate("build.toast.failed"), "error");
                }
            }
            previous = state.status;
        });
        return () => {
            unsub();
        };
    }, [context]);

    // Unlike Dev Mode and Preview, a running build does not turn its button into a
    // stop control, so the busy state brightens the icon itself against the plain
    // button background.
    const iconClass = useMemo(() => {
        if (status === "error") {
            return "text-danger";
        }
        if (status === "preparing" || status === "compiling" || status === "packaging") {
            return "text-fg";
        }
        return "";
    }, [status]);

    return <Package className={cn("w-4 h-4", iconClass)} />;
}

/**
 * File action group
 * Contains file-related actions like new, open, save
 */
export const fileActionGroup: ModuleActionGroup = {
    id: "narraleaf-studio:file",
    label: "File",
    labelKey: "actions.file.label",
    order: 10,
    // The macOS File menu is built natively so it can carry Cmd+N/Cmd+O; mirroring this group
    // would leave the menu bar with two File menus.
    menuSlot: "none",
    actions: [
        {
            id: "narraleaf-studio:file-new",
            label: "New Workspace",
            labelKey: "actions.file.new.label",
            icon: <FileText className="w-4 h-4" />,
            tooltip: "Create a new workspace",
            tooltipKey: "actions.file.new.tooltip",
            onClick: () => {
                void (async () => {
                    const result = await getInterface().app.launchProjectWizard({});
                    if (result.success && result.data?.created) {
                        // Opens alongside: File ▸ New is not a request to close this project.
                        await getInterface().workspace.launch({ projectPath: result.data.projectPath });
                    }
                })();
            },
            order: 0,
        },
        {
            id: "narraleaf-studio:file-open",
            label: "Open Workspace",
            labelKey: "actions.file.open.label",
            icon: <FolderOpen className="w-4 h-4" />,
            tooltip: "Open an existing workspace",
            tooltipKey: "actions.file.open.tooltip",
            onClick: () => {
                void (async () => {
                    const result = await getInterface().selectFolder();
                    if (!result.success || !result.data?.path) return;
                    // Focuses the project's window if it already has one, else opens alongside.
                    await getInterface().workspace.launch({ projectPath: result.data.path });
                })();
            },
            order: 1,
        },
        {
            id: "narraleaf-studio:file-export-project",
            label: "Export Project",
            labelKey: "actions.file.export.label",
            icon: <Archive className="w-4 h-4" />,
            tooltip: "Export the current project as a package",
            tooltipKey: "actions.file.export.tooltip",
            onClick: (workspace: Workspace) => {
                void (async () => {
                    const context = workspace.getContext();
                    const uiService = context.services.get<UIService>(Services.UI);

                    // Refresh the plugin dependency table so the exported package
                    // records exactly which plugins this project needs. Best-effort:
                    // a scan failure must not block the export itself.
                    try {
                        await context.services
                            .get<ProjectDependencyService>(Services.ProjectDependency)
                            .rescanAndPersist();
                    } catch (error) {
                        console.warn("[export] plugin dependency rescan failed", error);
                    }

                    uiService.showNotification(translate("actions.export.chooseFolder"), "info");

                    const projectPath = context.project.getConfig().projectPath;
                    const result = await getInterface().workspace.exportProjectPackage(projectPath);
                    if (!result.success) {
                        uiService.showNotification(result.error || translate("actions.export.failed"), "error");
                        return;
                    }
                    if (result.data.canceled) {
                        return;
                    }

                    const fileCount = result.data.fileCount ?? 0;
                    uiService.showNotification(translateN("actions.export.success", fileCount), "success");
                })();
            },
            order: 2,
        },
        Separator,
        {
            id: "narraleaf-studio:file-close-workspace",
            label: "Close",
            labelKey: "common.close",
            icon: <X className="w-4 h-4" />,
            tooltip: "Close the current workspace",
            tooltipKey: "actions.file.close.tooltip",
            onClick: () => {
                getInterface().workspace.close();
            },
            order: 3,
        },
    ],
};

export const helpActionGroup: ModuleActionGroup = {
    id: "narraleaf-studio:help",
    label: "Help",
    labelKey: "actions.help.label",
    order: 30,
    // Built natively as the standard macOS Help menu (see fileActionGroup).
    menuSlot: "none",
    actions: [
        {
            id: "narraleaf-studio:open-welcome",
            label: "Open Welcome",
            labelKey: "actions.help.welcome.label",
            tooltip: "Open welcome screen",
            tooltipKey: "actions.help.welcome.tooltip",
            onClick: (workspace: Workspace) => {
                openWelcomeTab(workspace.getContext());
            },
            order: 0,
        },
        {
            id: "narraleaf-studio:about",
            label: "About",
            labelKey: "actions.help.about.label",
            tooltip: "About NarraLeaf Studio",
            tooltipKey: "actions.help.about.tooltip",
            onClick: (workspace: Workspace) => {
                openAboutTab(workspace.getContext());
            },
            order: 1,
        },
    ],
};

/**
 * All global actions
 * Array of all actions that should be registered globally
 */
export const globalActions: ModuleAction[] = [buildAction];

/**
 * All global action groups
 * Array of all action groups that should be registered globally
 *
 * `fileActionGroup` is deliberately absent: it is registered by `useFileMenu`, which owns it so
 * the "Open Recent" submenu can track the project history live without two writers racing for the
 * same id. Its definition above stays the single source of the File group's New/Open/Export/Close.
 */
export const globalActionGroups: ModuleActionGroup[] = [helpActionGroup];
