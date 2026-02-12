import {
    Play,
    Bug,
    Hammer,
    FileText,
    FolderOpen,
    Save,
} from "lucide-react";
import { ModuleAction, ModuleActionGroup } from "../types";
import { Workspace } from "@/lib/workspace/workspace";
import { UIService } from "@/lib/workspace/services/ui";
import { Services } from "@/lib/workspace/services/services";
import { welcomeModule } from "../welcome";
import { getInterface } from "@/lib/app/bridge";
import { Separator } from "../../registry/types";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";

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
    icon: <Play className="w-4 h-4" />,
    tooltip: "Dev Mode",
    onClick: (workspace: Workspace) => {
        const projectPath = workspace.getContext().project.getConfig().projectPath;
        void getInterface().devMode.launch(projectPath, {
            kind: "surface",
            surfaceId: MAIN_APP_SURFACE_ID,
        });
    },
    order: 1,
};

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
                console.log("New file clicked");
                // TODO: Implement new file functionality
            },
            order: 0,
        },
        {
            id: "narraleaf-studio:file-open",
            label: "Open Workspace",
            icon: <FolderOpen className="w-4 h-4" />,
            tooltip: "Open an existing workspace",
            onClick: () => {
                console.log("Open file clicked");
                // TODO: Implement open file functionality
            },
            order: 1,
        },
        Separator,
        {
            id: "narraleaf-studio:file-save-as",
            label: "Close",
            icon: <Save className="w-4 h-4" />,
            tooltip: "Close the current workspace",
            onClick: () => {
                getInterface().workspace.close();
            },
            order: 2,
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

