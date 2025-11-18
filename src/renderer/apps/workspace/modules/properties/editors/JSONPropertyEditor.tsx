import { useState, useEffect } from "react";
import { FileJson } from "lucide-react";
import { PropertyEditorProps } from "./PropertyEditorBase";
import { BasePropertyEditor } from "./BasePropertyEditor";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";

/**
 * JSON property editor
 * Allows editing name, tags, and description for JSON assets
 */
export function JSONPropertyEditor({ asset, onChange }: PropertyEditorProps<AssetType.JSON>) {
    const { context } = useWorkspace();
    const [jsonData, setJsonData] = useState<AssetData<AssetType.JSON> | null>(null);

    // Load JSON metadata
    useEffect(() => {
        if (!context) return;

        const loadMetadata = async () => {
            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (result.success) {
                    setJsonData(result.data);
                }
            } catch (err) {
                console.error("Failed to load JSON metadata:", err);
            }
        };

        loadMetadata();
    }, [context, asset]);

    const getKeysCount = (data: Record<string, any>) => {
        try {
            return Object.keys(data).length;
        } catch {
            return 0;
        }
    };

    return (
        <BasePropertyEditor asset={asset} onChange={onChange}>
            {/* Preview */}
            {jsonData && (
                <div className="bg-[#1e1f22] rounded-md p-3 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                        <FileJson className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-300">JSON Structure</span>
                    </div>
                    <div className="flex items-center justify-center bg-[#0f1115] rounded p-2">
                        <div className="text-xs text-gray-500 text-center">
                            {jsonData.metadata.schema ? `Schema: ${jsonData.metadata.schema}` : 'No schema'}
                        </div>
                    </div>
                </div>
            )}

            {/* Technical Info (Read-only) */}
            {jsonData && (
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        JSON Information
                    </label>
                    <div className="bg-[#1e1f22] border border-white/10 rounded-md p-3 space-y-1">
                        {jsonData.metadata.schema && (
                            <div className="flex justify-between text-xs">
                                <span className="text-gray-400">Schema:</span>
                                <span className="text-gray-300">{jsonData.metadata.schema}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Size:</span>
                            <span className="text-gray-300">{(jsonData.metadata.size / 1024).toFixed(1)} KB</span>
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
