import { useState, useEffect } from "react";
import { Type } from "lucide-react";
import { PropertyEditorProps } from "./PropertyEditorBase";
import { BasePropertyEditor } from "./BasePropertyEditor";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";

/**
 * Font property editor
 * Allows editing name, tags, and description for font assets
 */
export function FontPropertyEditor({ asset, onChange }: PropertyEditorProps<AssetType.Font>) {
    const { context } = useWorkspace();
    const [fontData, setFontData] = useState<AssetData<AssetType.Font> | null>(null);

    // Load font metadata
    useEffect(() => {
        if (!context) return;

        const loadMetadata = async () => {
            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (result.success) {
                    setFontData(result.data);
                }
            } catch (err) {
                console.error("Failed to load font metadata:", err);
            }
        };

        loadMetadata();
    }, [context, asset]);

    return (
        <BasePropertyEditor asset={asset} onChange={onChange}>
            {/* Preview */}
            {fontData && (
                <div className="bg-surface-raised rounded-md p-3 border border-edge">
                    <div className="flex items-center gap-2 mb-2">
                        <Type className="w-4 h-4 text-fg-muted" />
                        <span className="text-sm font-medium text-fg-muted">Font Preview</span>
                    </div>
                    <div className="flex items-center justify-center bg-surface rounded p-3">
                        <div
                            className="text-sm text-center text-fg-muted"
                            style={{
                                fontFamily: fontData.metadata.family || 'serif',
                                fontStyle: fontData.metadata.style || 'normal',
                                fontWeight: fontData.metadata.weight || 'normal'
                            }}
                        >
                            {fontData.metadata.family || 'Sample Text'}
                            <br />
                            <span className="text-xs text-fg-subtle">Aa Bb Cc 123</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Technical Info (Read-only) */}
            {fontData && (
                <div>
                    <label className="block text-xs font-medium text-fg-muted mb-1">
                        Font Information
                    </label>
                    <div className="bg-surface-raised border border-edge rounded-md p-3 space-y-1">
                        {fontData.metadata.family && (
                            <div className="flex justify-between text-xs">
                                <span className="text-fg-muted">Family:</span>
                                <span className="text-fg-muted">{fontData.metadata.family}</span>
                            </div>
                        )}
                        {fontData.metadata.style && (
                            <div className="flex justify-between text-xs">
                                <span className="text-fg-muted">Style:</span>
                                <span className="text-fg-muted">{fontData.metadata.style}</span>
                            </div>
                        )}
                        {fontData.metadata.weight && (
                            <div className="flex justify-between text-xs">
                                <span className="text-fg-muted">Weight:</span>
                                <span className="text-fg-muted">{fontData.metadata.weight}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">Format:</span>
                            <span className="text-fg-muted">{fontData.metadata.format.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">Size:</span>
                            <span className="text-fg-muted">{(fontData.metadata.size / 1024).toFixed(1)} KB</span>
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
