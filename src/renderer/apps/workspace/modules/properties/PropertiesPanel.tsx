import { useState, useEffect } from "react";
import { Settings } from "lucide-react";
import { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { ImagePropertyEditor } from "./editors/ImagePropertyEditor";
import { AudioPropertyEditor } from "./editors/AudioPropertyEditor";
import { VideoPropertyEditor } from "./editors/VideoPropertyEditor";
import { JSONPropertyEditor } from "./editors/JSONPropertyEditor";
import { FontPropertyEditor } from "./editors/FontPropertyEditor";
import { OtherPropertyEditor } from "./editors/OtherPropertyEditor";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterPropertiesEditor } from "../characters/editors/CharacterPropertiesEditor";

/**
 * Properties panel component
 * Shows properties/inspector for the selected item based on active editor
 */
export function PropertiesPanel({ panelId, payload }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const [activeAsset, setActiveAsset] = useState<Asset | null>(null);
    const [activeCharacter, setActiveCharacter] = useState<Character | null>(null);
    const [, setCharacterVersion] = useState(0);

    // Listen selection changes
    useEffect(() => {
        if (!context) return;
        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();

        const setSelectionState = (selection: any) => {
            setActiveAsset(selection.type === "asset" ? selection.data as Asset : null);
            setActiveCharacter(selection.type === "character" ? selection.data as Character : null);
        };

        setSelectionState(store.getSelection());

        const unsub = uiService.getEvents().on("selectionChanged", sel => {
            setSelectionState(sel);
        });

        return unsub;
    }, [context]);

    // Listen character changes so header reflects rename/group updates
    useEffect(() => {
        if (!activeCharacter) return;
        const unsub = activeCharacter.subscribe(() => {
            setCharacterVersion(v => v + 1);
        });
        return unsub;
    }, [activeCharacter]);

    // Render appropriate property editor based on asset type
    const renderPropertyEditor = () => {
        if (!activeAsset && !activeCharacter) {
            return (
                <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center text-gray-500 py-8">
                        <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">No item selected</p>
                        <p className="text-xs mt-1">Select an item to view its properties</p>
                    </div>
                </div>
            );
        }

        if (activeCharacter) {
            return <CharacterPropertiesEditor character={activeCharacter} />;
        }

        if (!activeAsset) {
            return null;
        }

        switch (activeAsset.type) {
            case AssetType.Image:
                return <ImagePropertyEditor asset={activeAsset as Asset<AssetType.Image>} />;
            case AssetType.Audio:
                return <AudioPropertyEditor asset={activeAsset as Asset<AssetType.Audio>} />;
            case AssetType.Video:
                return <VideoPropertyEditor asset={activeAsset as Asset<AssetType.Video>} />;
            case AssetType.JSON:
                return <JSONPropertyEditor asset={activeAsset as Asset<AssetType.JSON>} />;
            case AssetType.Font:
                return <FontPropertyEditor asset={activeAsset as Asset<AssetType.Font>} />;
            case AssetType.Other:
                return <OtherPropertyEditor asset={activeAsset as Asset<AssetType.Other>} />;

            default:
                return null;
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                        {activeCharacter
                            ? activeCharacter.profile.getProfile().name
                            : activeAsset
                                ? activeAsset.name
                                : "Properties"}
                    </span>
                </div>
                {(activeAsset || activeCharacter) && (
                    <span className="text-xs text-gray-500 uppercase">
                        {activeCharacter ? "Character" : activeAsset?.type}
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
