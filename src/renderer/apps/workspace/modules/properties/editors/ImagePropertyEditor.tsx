import { useState, useEffect } from "react";
import { Image as ImageIcon } from "lucide-react";
import { PropertyEditorProps } from "./PropertyEditorBase";
import { BasePropertyEditor } from "./BasePropertyEditor";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";

/**
 * Image property editor
 * Allows editing name, tags, and description for image assets
 */
export function ImagePropertyEditor({ asset, onChange }: PropertyEditorProps<AssetType.Image>) {
    const { context } = useWorkspace();
    const [imageData, setImageData] = useState<AssetData<AssetType.Image> | null>(null);

    // Load image metadata
    useEffect(() => {
        if (!context) return;

        const loadMetadata = async () => {
            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (result.success) {
                    setImageData(result.data);
                }
            } catch (err) {
                console.error("Failed to load image metadata:", err);
            }
        };

        loadMetadata();
    }, [context, asset]);

    return (
        <BasePropertyEditor asset={asset} onChange={onChange}>
            {/* Technical Info (Read-only) */}
            {imageData && (
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        Image Information
                    </label>
                    <div className="bg-[#1e1f22] border border-white/10 rounded-md p-3 space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Dimensions:</span>
                            <span className="text-gray-300">
                                {imageData.metadata.width} × {imageData.metadata.height}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Format:</span>
                            <span className="text-gray-300">{imageData.metadata.format.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Size:</span>
                            <span className="text-gray-300">{(imageData.metadata.size / 1024).toFixed(1)} KB</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Hash:</span>
                            <span className="text-gray-300 font-mono text-[10px]">{asset.hash.slice(0, 16)}...</span>
                        </div>
                    </div>
                </div>
            )}
        </BasePropertyEditor>
    );
}

