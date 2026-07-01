import { useEffect, useMemo, useState } from "react";
import {
    Play,
    Bug,
    Hammer,
    FileText,
    FolderOpen,
    X,
    Archive,
} from "lucide-react";
import { ModuleAction, ModuleActionGroup } from "../types";
import { Workspace } from "@/lib/workspace/workspace";
import { UIService } from "@/lib/workspace/services/ui";
import { Services } from "@/lib/workspace/services/services";
import { welcomeModule } from "../welcome";
import { getInterface } from "@/lib/app/bridge";
import { Separator } from "../../registry/types";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import type { DevModeStatus } from "@shared/types/devMode";
import { useWorkspace } from "../../context";
import { flushUIDocAndGraphIfDirty } from "./flushDevModeAssets";

/**
 * Global toolbar actions
 * These actions are always available in the top action bar
 */

/**
 * Run project action
 * Executes the current project
 */
/**
 * Dev mode action
 * Launches dev mode window for the current project
 */
export const devModeAction: ModuleAction = {
    id: "narraleaf-studio:dev-mode",
    icon: <DevModeActionIcon />,
    tooltip: "Dev Mode",
    onClick: (workspace: Workspace) => {
        const devModeService = workspace.getContext().services.get<DevModeService>(Services.DevMode);
        const status = devModeService.getStatus();
        const sessionActive =
            status === "running" ||
            status === "compiling" ||
            status === "starting" ||
            status === "reloading";
        if (sessionActive) {
            void devModeService.stop();
            return;
        }
        void (async () => {
            try {
                await flushUIDocAndGraphIfDirty(workspace);
            } catch (e) {
                console.error("[DevMode] flush before launch failed", e);
            }
            await devModeService.launch({
                kind: "surface",
                surfaceId: MAIN_APP_SURFACE_ID,
            });
        })();
    },
    order: 1,
};

function DevModeActionIcon() {
    const { context } = useWorkspace();
    const [status, setStatus] = useState<DevModeStatus>("idle");

    useEffect(() => {
        if (!context) {
            return;
        }
        const devModeService = context.services.get<DevModeService>(Services.DevMode);
        setStatus(devModeService.getStatus());
        const unsub = devModeService.onStatusChanged(setStatus);
        return () => {
            unsub();
        };
    }, [context]);

    const iconColor = useMemo(() => {
        if (status === "error") {
            return "#f87171";
        }
        if (status !== "idle") {
            return "#ffffff";
        }
        return "rgba(255,255,255,0.6)";
    }, [status]);

    return <Play className="w-4 h-4" color={iconColor} />;
}

/**
 * Debug project action
 * Starts debugging the current project
 */
export const debugAction: ModuleAction = {
    id: "narraleaf-studio:debug",
    icon: <Bug className="w-4 h-4" />,
    tooltip: "Debug project",
    onClick: () => {
        console.log("Debug clicked");
        // TODO: Implement debug functionality
    },
    order: 3,
};

/**
 * Build project action
 * Builds the current project for distribution
 */
export const buildAction: ModuleAction = {
    id: "narraleaf-studio:build",
    icon: <Hammer className="w-4 h-4" />,
    tooltip: "Build project",
    onClick: () => {
        console.log("Build clicked");
        // TODO: Implement build functionality
    },
    order: 4,
};

/**
 * File action group
 * Contains file-related actions like new, open, save
 */
export const fileActionGroup: ModuleActionGroup = {
    id: "narraleaf-studio:file",
    label: "File",
    order: 10,
    actions: [
        {
            id: "narraleaf-studio:file-new",
            label: "New Workspace",
            icon: <FileText className="w-4 h-4" />,
            tooltip: "Create a new workspace",
            onClick: () => {
                void (async () => {
                    const result = await getInterface().app.launchProjectWizard({});
                    if (result.success && result.data?.created) {
                        await getInterface().workspace.launch(
                            { projectPath: result.data.projectPath },
                            true
                        );
                    }
                })();
            },
            order: 0,
        },
        {
            id: "narraleaf-studio:file-open",
            label: "Open Workspace",
            icon: <FolderOpen className="w-4 h-4" />,
            tooltip: "Open an existing workspace",
            onClick: () => {
                void (async () => {
                    const result = await getInterface().selectFolder();
                    if (!result.success || !result.data?.path) return;
                    await getInterface().workspace.launch(
                        { projectPath: result.data.path },
                        true
                    );
                })();
            },
            order: 1,
        },
        {
            id: "narraleaf-studio:file-export-project",
            label: "Export Project",
            icon: <Archive className="w-4 h-4" />,
            tooltip: "Export the current project as a package",
            onClick: (workspace: Workspace) => {
                void (async () => {
                    const uiService = workspace.getContext().services.get<UIService>(Services.UI);
                    uiService.showNotification("Choose a folder for the exported project package.", "info");

                    const projectPath = workspace.getContext().project.getConfig().projectPath;
                    const result = await getInterface().workspace.exportProjectPackage(projectPath);
                    if (!result.success) {
                        uiService.showNotification(result.error || "Failed to export project.", "error");
                        return;
                    }
                    if (result.data.canceled) {
                        return;
                    }

                    const fileCount = result.data.fileCount ?? 0;
                    uiService.showNotification(`Exported project package with ${fileCount} files.`, "success");
                })();
            },
            order: 2,
        },
        Separator,
        {
            id: "narraleaf-studio:file-close-workspace",
            label: "Close",
            icon: <X className="w-4 h-4" />,
            tooltip: "Close the current workspace",
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
    order: 30,
    actions: [
        {
            id: "narraleaf-studio:open-welcome",
            label: "Open Welcome",
            tooltip: "Open welcome screen",
            onClick: (workspace: Workspace) => {
                const uiService = workspace.getContext().services.get<UIService>(Services.UI);
                uiService.editor.open({
                    id: welcomeModule.metadata.id,
                    title: welcomeModule.metadata.title,
                    icon: welcomeModule.metadata.icon,
                    component: welcomeModule.component as any,
                    closable: welcomeModule.metadata.closable,
                    modified: welcomeModule.metadata.modified,
                });
            },
            order: 0,
        },
    ],
};

/**
 * All global actions
 * Array of all actions that should be registered globally
 */
export const globalActions: ModuleAction[] = [devModeAction, debugAction, buildAction];

/**
 * All global action groups
 * Array of all action groups that should be registered globally
 */
export const globalActionGroups: ModuleActionGroup[] = [fileActionGroup, helpActionGroup];
