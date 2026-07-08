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
                    <label className="block text-xs font-medium text-fg-muted mb-1">
                        Image Information
                    </label>
                    <div className="bg-surface-raised border border-edge rounded-md p-3 space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">Dimensions:</span>
                            <span className="text-fg-muted">
                                {imageData.metadata.width} × {imageData.metadata.height}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">Format:</span>
                            <span className="text-fg-muted">{imageData.metadata.format.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">Size:</span>
                            <span className="text-fg-muted">{(imageData.metadata.size / 1024).toFixed(1)} KB</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">Hash:</span>
                            <span className="text-fg-muted font-mono text-2xs">{asset.hash.slice(0, 16)}...</span>
                        </div>
                    </div>
                </div>
            )}
        </BasePropertyEditor>
    );
}

