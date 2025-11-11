import { FolderOpen, Upload } from "lucide-react";
import { PanelModule } from "../types";
import { AssetsPanel } from "./AssetsPanel";
import { PanelPosition } from "../../registry/types";
import { FocusArea, FocusContext } from "@/lib/workspace/services/ui/types";
import { Workspace } from "@/lib/workspace/workspace";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Services } from "@/lib/workspace/services/services";

const when = (context: FocusContext) => context.area === FocusArea.LeftPanel && context.targetId === "narraleaf-studio:assets";

/**
 * Assets panel module
 * Manages project assets and resources
 */
export const assetsModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:assets",
        title: "Assets",
        icon: <FolderOpen className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: true,
        order: 0,
    },
    component: AssetsPanel,
    // Actions specific to the assets panel can be added here
    // actions: [
    //     // Example: Import asset action
    //     {
    //         id: "narraleaf-studio:assets-import",
    //         label: "Import Asset",
    //         icon: <Upload className="w-4 h-4" />,
    //         tooltip: "Import a new asset",
    //         onClick: () => {
    //             console.log("Import asset");
    //         },
    //         when: (context) => context.area === FocusArea.LeftPanel && context.targetId === "narraleaf-studio:assets",
    //         order: 100,
    //     },
    // ],
    actionGroups: [
        {
            id: "narraleaf-studio:assets-actions",
            label: "Assets",
            actions: [
                {
                    id: "narraleaf-studio:assets-import",
                    label: "Import Images",
                    tooltip: "Import a new asset",
                    when,
                    onClick: async (workspace: Workspace) => {
                        const result = await workspace.getContext().services.get<AssetsService>(Services.Assets).importLocalAssets(AssetType.Image);
                        console.log(result);
                    },
                },
                {
                    id: "narraleaf-studio:assets-print",
                    label: "Print Assets",
                    tooltip: "Print assets metadata to the console",
                    when,
                    onClick: (workspace: Workspace) => {
                        const assets = workspace.getContext().services.get<AssetsService>(Services.Assets).getAssets();
                        console.log(assets);
                    },
                },
            ],
        },
    ],
    // Keybindings specific to the assets panel
    // keybindings: [
    //     // Example: Refresh keybinding
    //     {
    //         id: "narraleaf-studio:assets-refresh",
    //         key: "f5",
    //         description: "Refresh assets",
    //         handler: () => {
    //             console.log("Refresh assets");
    //         },
    //         when: (context) => context.area === FocusArea.LeftPanel && context.targetId === "narraleaf-studio:assets",
    //     },
    // ],
};

