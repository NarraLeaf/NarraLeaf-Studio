import { useState, useEffect } from "react";
import { Video } from "lucide-react";
import { PropertyEditorProps } from "./PropertyEditorBase";
import { BasePropertyEditor } from "./BasePropertyEditor";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";

/**
 * Video property editor
 * Allows editing name, tags, and description for video assets
 */
export function VideoPropertyEditor({ asset, onChange }: PropertyEditorProps<AssetType.Video>) {
    const { context } = useWorkspace();
    const [videoData, setVideoData] = useState<AssetData<AssetType.Video> | null>(null);

    // Load video metadata
    useEffect(() => {
        if (!context) return;

        const loadMetadata = async () => {
            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (result.success) {
                    setVideoData(result.data);
                }
            } catch (err) {
                console.error("Failed to load video metadata:", err);
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
            {videoData && (
                <div className="bg-surface-raised rounded-md p-3 border border-edge">
                    <div className="flex items-center gap-2 mb-2">
                        <Video className="w-4 h-4 text-fg-muted" />
                        <span className="text-sm font-medium text-fg-muted">Video Info</span>
                    </div>
                    <div className="flex items-center justify-center bg-surface rounded p-2">
                        <div className="text-xs text-fg-subtle text-center">
                            {videoData.metadata.width} × {videoData.metadata.height}
                            <br />
                            {formatDuration(videoData.metadata.duration)}
                            <br />
                            {videoData.metadata.frameRate ? `${videoData.metadata.frameRate} FPS` : ''}
                        </div>
                    </div>
                </div>
            )}

            {/* Technical Info (Read-only) */}
            {videoData && (
                <div>
                    <label className="block text-xs font-medium text-fg-muted mb-1">
                        Video Information
                    </label>
                    <div className="bg-surface-raised border border-edge rounded-md p-3 space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">Duration:</span>
                            <span className="text-fg-muted">{formatDuration(videoData.metadata.duration)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">Dimensions:</span>
                            <span className="text-fg-muted">
                                {videoData.metadata.width} × {videoData.metadata.height}
                            </span>
                        </div>
                        {videoData.metadata.frameRate && (
                            <div className="flex justify-between text-xs">
                                <span className="text-fg-muted">Frame Rate:</span>
                                <span className="text-fg-muted">{videoData.metadata.frameRate} FPS</span>
                            </div>
                        )}
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">Format:</span>
                            <span className="text-fg-muted">{videoData.metadata.format.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-fg-muted">Size:</span>
                            <span className="text-fg-muted">{(videoData.metadata.size / 1024).toFixed(1)} KB</span>
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
