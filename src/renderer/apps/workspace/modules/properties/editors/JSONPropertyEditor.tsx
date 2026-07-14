import { useState, useEffect } from "react";
import { FileJson } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
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
    const { t } = useTranslation();
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
                <div className="bg-surface-raised rounded-md p-3 border border-edge">
                    <div className="flex items-center gap-2 mb-2">
                        <FileJson className="w-4 h-4 text-fg-muted" />
                        <span className="text-sm font-medium text-fg-muted">{t("properties.asset.json.preview")}</span>
                    </div>
                    <div className="flex items-center justify-center bg-surface rounded p-2">
                        <div className="text-xs text-fg-subtle text-center">
                            {jsonData.metadata.schema
                                ? t("properties.asset.json.schemaValue", { schema: jsonData.metadata.schema })
                                : t("properties.asset.json.noSchema")}
                        </div>
                    </div>
                </div>
            )}

            {/* Technical Info (Read-only) */}
            {jsonData && (
                <div>
                    <label className="block text-xs font-medium text-fg-muted mb-1">
                        {t("properties.asset.json.info")}
                    </label>
                    <div className="bg-surface-raised border border-edge rounded-md p-3 space-y-1">
                        {jsonData.metadata.schema && (
                            <div className="flex justify-between text-xs">
                                <span className="text-fg-muted">{t("properties.asset.info.schema")}:</span>
                                <span className="text-fg-muted">{jsonData.metadata.schema}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">{t("properties.asset.info.size")}:</span>
                            <span className="text-fg-muted">{(jsonData.metadata.size / 1024).toFixed(1)} KB</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">{t("properties.asset.info.hash")}:</span>
                            <span className="text-fg-muted font-mono text-2xs">{asset.hash.slice(0, 16)}...</span>
                        </div>
                    </div>
                </div>
            )}
        </BasePropertyEditor>
    );
}
