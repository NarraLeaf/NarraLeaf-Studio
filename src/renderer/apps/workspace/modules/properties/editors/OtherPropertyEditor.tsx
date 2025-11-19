import { useState, useEffect } from "react";
import { File } from "lucide-react";
import { PropertyEditorProps } from "./PropertyEditorBase";
import { BasePropertyEditor } from "./BasePropertyEditor";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";

/**
 * Other property editor
 * Allows editing name, tags, and description for other file assets
 */
export function OtherPropertyEditor({ asset, onChange }: PropertyEditorProps<AssetType.Other>) {
    const { context } = useWorkspace();
    const [otherData, setOtherData] = useState<AssetData<AssetType.Other> | null>(null);

    // Load other file metadata
    useEffect(() => {
        if (!context) return;

        const loadMetadata = async () => {
            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (result.success) {
                    setOtherData(result.data);
                }
            } catch (err) {
                console.error("Failed to load file metadata:", err);
            }
        };

        loadMetadata();
    }, [context, asset]);

    const getFileExtension = (filename: string) => {
        const parts = filename.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'Unknown';
    };

    return (
        <BasePropertyEditor asset={asset} onChange={onChange}>
            {/* Preview */}
            {otherData && (
                <div className="bg-[#1e1f22] rounded-md p-3 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                        <File className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-300">File Info</span>
                    </div>
                    <div className="flex items-center justify-center bg-[#0f1115] rounded p-2">
                        <div className="text-xs text-gray-500 text-center">
                            {getFileExtension(asset.name)} File
                            <br />
                            {otherData.metadata.mimeType || 'Unknown type'}
                            <br />
                            {(otherData.metadata.size / 1024).toFixed(1)} KB
                        </div>
                    </div>
                </div>
            )}

            {/* Technical Info (Read-only) */}
            {otherData && (
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        File Information
                    </label>
                    <div className="bg-[#1e1f22] border border-white/10 rounded-md p-3 space-y-1">
                        {otherData.metadata.mimeType && (
                            <div className="flex justify-between text-xs">
                                <span className="text-gray-400">MIME Type:</span>
                                <span className="text-gray-300">{otherData.metadata.mimeType}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Extension:</span>
                            <span className="text-gray-300">{getFileExtension(asset.name)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Size:</span>
                            <span className="text-gray-300">{(otherData.metadata.size / 1024).toFixed(1)} KB</span>
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
