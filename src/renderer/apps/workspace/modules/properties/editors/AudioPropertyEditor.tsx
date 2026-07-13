import { useState, useEffect } from "react";
import { Music } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { PropertyEditorProps } from "./PropertyEditorBase";
import { BasePropertyEditor } from "./BasePropertyEditor";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";

/**
 * Audio property editor
 * Allows editing name, tags, and description for audio assets
 */
export function AudioPropertyEditor({ asset, onChange }: PropertyEditorProps<AssetType.Audio>) {
    const { t, tn } = useTranslation();
    const { context } = useWorkspace();
    const [audioData, setAudioData] = useState<AssetData<AssetType.Audio> | null>(null);

    // Load audio metadata
    useEffect(() => {
        if (!context) return;

        const loadMetadata = async () => {
            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (result.success) {
                    setAudioData(result.data);
                }
            } catch (err) {
                console.error("Failed to load audio metadata:", err);
            }
        };

        loadMetadata();
    }, [context, asset]);

    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    return (
        <BasePropertyEditor asset={asset} onChange={onChange}>
            {/* Preview */}
            {audioData && (
                <div className="bg-surface-raised rounded-md p-3 border border-edge">
                    <div className="flex items-center gap-2 mb-2">
                        <Music className="w-4 h-4 text-fg-muted" />
                        <span className="text-sm font-medium text-fg-muted">{t("properties.asset.audio.preview")}</span>
                    </div>
                    <div className="flex items-center justify-center bg-surface rounded p-2">
                        <div className="text-xs text-fg-subtle text-center">
                            {formatDuration(audioData.metadata.duration)}
                            <br />
                            {tn("properties.asset.audio.channelCount", audioData.metadata.channels)}
                            <br />
                            {audioData.metadata.sampleRate} Hz
                        </div>
                    </div>
                </div>
            )}

            {/* Technical Info (Read-only) */}
            {audioData && (
                <div>
                    <label className="block text-xs font-medium text-fg-muted mb-1">
                        {t("properties.asset.audio.info")}
                    </label>
                    <div className="bg-surface-raised border border-edge rounded-md p-3 space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">{t("properties.asset.info.duration")}:</span>
                            <span className="text-fg-muted">{formatDuration(audioData.metadata.duration)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">{t("properties.asset.info.sampleRate")}:</span>
                            <span className="text-fg-muted">{audioData.metadata.sampleRate} Hz</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">{t("properties.asset.info.channels")}:</span>
                            <span className="text-fg-muted">{audioData.metadata.channels}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">{t("properties.asset.info.format")}:</span>
                            <span className="text-fg-muted">{audioData.metadata.format.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">{t("properties.asset.info.size")}:</span>
                            <span className="text-fg-muted">{(audioData.metadata.size / 1024).toFixed(1)} KB</span>
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
