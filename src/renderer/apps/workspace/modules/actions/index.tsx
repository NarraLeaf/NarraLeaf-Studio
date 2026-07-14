import { useEffect, useMemo, useState } from "react";
import {
    Play,
    Hammer,
    Package,
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
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import { PreviewService } from "@/lib/workspace/services/core/PreviewService";
import { ConsoleService } from "@/lib/workspace/services/core/ConsoleService";
import type { DevModeStatus } from "@shared/types/devMode";
import type { PreviewStatus } from "@shared/types/gameRuntime";
import { useWorkspace } from "../../context";
import { flushUIDocAndGraphIfDirty } from "./flushDevModeAssets";
import { isDevModeRuntimeActive, isPreviewRuntimeActive } from "./runtimeActionStatus";
import { translate, translateN } from "@/lib/i18n";

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
    tooltipKey: "actions.devMode.tooltip",
    onClick: (workspace: Workspace) => {
        const devModeService = workspace.getContext().services.get<DevModeService>(Services.DevMode);
        const status = devModeService.getStatus();
        if (isDevModeRuntimeActive(status)) {
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
        if (isDevModeRuntimeActive(status)) {
            return "#ffffff";
        }
        return "rgba(255,255,255,0.6)";
    }, [status]);

    return <Play className="w-4 h-4" color={iconColor} />;
}

export const previewAction: ModuleAction = {
    id: "narraleaf-studio:preview",
    icon: <PreviewActionIcon />,
    tooltip: "Preview",
    tooltipKey: "actions.preview.tooltip",
    onClick: (workspace: Workspace) => {
        const previewService = workspace.getContext().services.get<PreviewService>(Services.Preview);
        const status = previewService.getStatus();
        if (isPreviewRuntimeActive(status)) {
            void previewService.stop();
            return;
        }
        void previewService.launch({
            kind: "surface",
            surfaceId: MAIN_APP_SURFACE_ID,
        });
    },
    order: 2,
};

function PreviewActionIcon() {
    const { context } = useWorkspace();
    const [status, setStatus] = useState<PreviewStatus>("idle");

    useEffect(() => {
        if (!context) {
            return;
        }
        const previewService = context.services.get<PreviewService>(Services.Preview);
        setStatus(previewService.getStatus());
        const unsub = previewService.onStatusChanged(setStatus);
        return () => {
            unsub();
        };
    }, [context]);

    const iconColor = useMemo(() => {
        if (status === "error") {
            return "#f87171";
        }
        if (isPreviewRuntimeActive(status)) {
            return "#ffffff";
        }
        return "rgba(255,255,255,0.6)";
    }, [status]);

    return <Hammer className="w-4 h-4" color={iconColor} />;
}

/**
 * Build project action
 * Builds the current project for distribution
 */
export const buildAction: ModuleAction = {
    id: "narraleaf-studio:build",
    icon: <Package className="w-4 h-4" />,
    tooltip: "Build project",
    tooltipKey: "actions.build.tooltip",
    onClick: (workspace: Workspace) => {
        const services = workspace.getContext().services;
        const consoleService = services.get<ConsoleService>(Services.Console);
        const uiService = services.get<UIService>(Services.UI);
        const projectPath = workspace.getContext().project.getConfig().projectPath;
        const projectName = projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "project";

        uiService.panels.show("narraleaf-studio:console");
        consoleService.append("build", {
            level: "info",
            source: translate("actions.build.source"),
            segments: [
                { text: translate("actions.build.requested", { name: projectName }), color: "#8b949e" },
            ],
        });
        consoleService.append("build", {
            level: "warning",
            source: translate("actions.build.source"),
            segments: [
                { text: translate("actions.build.notWiredTitle"), bold: true },
                { text: translate("actions.build.notWiredDetail"), italic: true },
            ],
        });
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
    labelKey: "actions.file.label",
    order: 10,
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
            labelKey: "actions.file.open.label",
            icon: <FolderOpen className="w-4 h-4" />,
            tooltip: "Open an existing workspace",
            tooltipKey: "actions.file.open.tooltip",
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
    actions: [
        {
            id: "narraleaf-studio:open-welcome",
            label: "Open Welcome",
            labelKey: "actions.help.welcome.label",
            tooltip: "Open welcome screen",
            tooltipKey: "actions.help.welcome.tooltip",
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
export const globalActions: ModuleAction[] = [devModeAction, previewAction, buildAction];

/**
 * All global action groups
 * Array of all action groups that should be registered globally
 */
export const globalActionGroups: ModuleActionGroup[] = [fileActionGroup, helpActionGroup];
