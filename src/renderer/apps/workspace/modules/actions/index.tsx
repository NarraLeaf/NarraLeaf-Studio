import {
    Play,
    Bug,
    Hammer,
    FileText,
    FolderOpen,
    Save,
    Copy,
    Scissors,
    Clipboard,
} from "lucide-react";
import { ModuleAction, ModuleActionGroup } from "../types";
import { Workspace } from "@/lib/workspace/workspace";
import { UIService } from "@/lib/workspace/services/ui";
import { Services } from "@/lib/workspace/services/services";
import { welcomeModule } from "../welcome";

/**
 * Global toolbar actions
 * These actions are always available in the top action bar
 */

/**
 * Run project action
 * Executes the current project
 */
export const runAction: ModuleAction = {
    id: "narraleaf-studio:run",
    icon: <Play className="w-4 h-4" />,
    tooltip: "Run project",
    onClick: () => {
        console.log("Run clicked");
        // TODO: Implement run functionality
    },
    order: 2,
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
            label: "New File",
            icon: <FileText className="w-4 h-4" />,
            tooltip: "Create a new file",
            onClick: () => {
                console.log("New file clicked");
                // TODO: Implement new file functionality
            },
            order: 0,
        },
        {
            id: "narraleaf-studio:file-open",
            label: "Open File",
            icon: <FolderOpen className="w-4 h-4" />,
            tooltip: "Open an existing file",
            onClick: () => {
                console.log("Open file clicked");
                // TODO: Implement open file functionality
            },
            order: 1,
        },
        {
            id: "narraleaf-studio:file-save-as",
            label: "Save As...",
            icon: <Save className="w-4 h-4" />,
            tooltip: "Save file with a different name",
            onClick: () => {
                console.log("Save as clicked");
                // TODO: Implement save as functionality
            },
            order: 2,
        },
    ],
};

/**
 * Edit action group
 * Contains edit-related actions like copy, cut, paste
 */
export const editActionGroup: ModuleActionGroup = {
    id: "narraleaf-studio:edit",
    label: "Edit",
    order: 20,
    actions: [
        {
            id: "narraleaf-studio:edit-copy",
            label: "Copy",
            icon: <Copy className="w-4 h-4" />,
            tooltip: "Copy selected content",
            onClick: () => {
                console.log("Copy clicked");
                // TODO: Implement copy functionality
            },
            order: 0,
        },
        {
            id: "narraleaf-studio:edit-cut",
            label: "Cut",
            icon: <Scissors className="w-4 h-4" />,
            tooltip: "Cut selected content",
            onClick: () => {
                console.log("Cut clicked");
                // TODO: Implement cut functionality
            },
            order: 1,
        },
        {
            id: "narraleaf-studio:edit-paste",
            label: "Paste",
            icon: <Clipboard className="w-4 h-4" />,
            tooltip: "Paste content",
            onClick: () => {
                console.log("Paste clicked");
                // TODO: Implement paste functionality
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
export const globalActions: ModuleAction[] = [runAction, debugAction, buildAction];

/**
 * All global action groups
 * Array of all action groups that should be registered globally
 */
export const globalActionGroups: ModuleActionGroup[] = [fileActionGroup, editActionGroup, helpActionGroup];

