import { useEffect } from "react";
import { Settings, Play, Save, FolderOpen, Terminal, FileText, Copy, Scissors, Clipboard, Bug, Hammer } from "lucide-react";
import { useRegistry } from "../registry";
import { PanelPosition } from "../registry/types";
import { PropertiesPanel, ConsolePanel } from "../panels";

/**
 * Hook to register default UI components
 * This hook should be called once when the workspace initializes
 */
export function useDefaultUIComponents() {
    const { registerPanel, registerAction, registerActionGroup } = useRegistry();

    useEffect(() => {
        // Register Properties panel on the right sidebar
        registerPanel({
            id: "narraleaf-studio:properties",
            title: "Properties",
            icon: <Settings className="w-4 h-4" />,
            position: PanelPosition.Right,
            component: PropertiesPanel,
            defaultVisible: true,
            order: 0,
        });

        // Register Console panel at the bottom
        registerPanel({
            id: "narraleaf-studio:console",
            title: "Console",
            icon: <Terminal className="w-4 h-4" />,
            position: PanelPosition.Bottom,
            component: ConsolePanel,
            defaultVisible: false,
            order: 0,
        });

        registerAction({
            id: "narraleaf-studio:run",
            icon: <Play className="w-4 h-4" />,
            tooltip: "Run project",
            onClick: () => {
                console.log("Run clicked");
                // TODO: Implement run functionality
            },
            order: 2,
        });

        registerAction({
            id: "narraleaf-studio:debug",
            icon: <Bug className="w-4 h-4" />,
            tooltip: "Debug project",
            onClick: () => {
                console.log("Debug clicked");
                // TODO: Implement debug functionality
            },
            order: 3,
        });

        registerAction({
            id: "narraleaf-studio:build",
            icon: <Hammer className="w-4 h-4" />,
            tooltip: "Build project",
            onClick: () => {
                console.log("Build clicked");
                // TODO: Implement build functionality
            },
            order: 4,
        });

        // Register action groups
        registerActionGroup({
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
        });

        registerActionGroup({
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
        });

        // Cleanup is handled automatically by the registry
    }, [registerPanel, registerAction, registerActionGroup]);
}
