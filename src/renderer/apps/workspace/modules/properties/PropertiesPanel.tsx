import { useState, useEffect } from "react";
import { Settings, Image as ImageIcon } from "lucide-react";
import { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { ImagePropertyEditor } from "./editors/ImagePropertyEditor";

/**
 * Properties panel component
 * Shows properties/inspector for the selected item based on active editor
 */
export function PropertiesPanel({ panelId, payload }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const [activeAsset, setActiveAsset] = useState<Asset | null>(null);

    // Monitor active editor and extract asset from payload
    useEffect(() => {
        if (!context || !isInitialized) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();

        // Get initial active editor
        const initialState = store.getState();
        const activeTabId = initialState.activeEditorTabId;
        if (activeTabId) {
            const activeTab = initialState.editorTabs.find(tab => tab.id === activeTabId);
            if (activeTab && activeTab.payload && (activeTab.payload as any).asset) {
                setActiveAsset((activeTab.payload as any).asset);
            }
        }

        // Listen for editor changes
        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.activeEditorTabId || changes.editorTabs) {
                const state = store.getState();
                const activeTabId = state.activeEditorTabId;
                
                if (activeTabId) {
                    const activeTab = state.editorTabs.find(tab => tab.id === activeTabId);
                    if (activeTab && activeTab.payload && (activeTab.payload as any).asset) {
                        setActiveAsset((activeTab.payload as any).asset);
                    } else {
                        setActiveAsset(null);
                    }
                } else {
                    setActiveAsset(null);
                }
            }
        });

        return unsubscribe;
    }, [context, isInitialized]);

    // Render appropriate property editor based on asset type
    const renderPropertyEditor = () => {
        if (!activeAsset) {
            return (
                <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center text-gray-500 py-8">
                        <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">No item selected</p>
                        <p className="text-xs mt-1">Select an asset to view its properties</p>
                    </div>
                </div>
            );
        }

        switch (activeAsset.type) {
            case AssetType.Image:
                return <ImagePropertyEditor asset={activeAsset as Asset<AssetType.Image>} />;
            
            // Add other asset type editors here
            case AssetType.Audio:
            case AssetType.Video:
            case AssetType.JSON:
            case AssetType.Font:
            case AssetType.Other:
                return (
                    <div className="flex-1 flex items-center justify-center p-4">
                        <div className="text-center text-gray-500 py-8">
                            <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p className="text-sm">Property editor not available</p>
                            <p className="text-xs mt-1">
                                Editor for {activeAsset.type} assets is not yet implemented
                            </p>
                        </div>
                    </div>
                );
            
            default:
                return null;
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4 text-gray-400" />
                    <span className="text-xs text-gray-400">
                        {activeAsset ? activeAsset.name : "Properties"}
                    </span>
                </div>
                {activeAsset && (
                    <span className="text-xs text-gray-500 uppercase">
                        {activeAsset.type}
                    </span>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {renderPropertyEditor()}
            </div>
        </div>
    );
}
