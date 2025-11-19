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
                <div className="bg-[#1e1f22] rounded-md p-3 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                        <Video className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-300">Video Info</span>
                    </div>
                    <div className="flex items-center justify-center bg-[#0f1115] rounded p-2">
                        <div className="text-xs text-gray-500 text-center">
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
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        Video Information
                    </label>
                    <div className="bg-[#1e1f22] border border-white/10 rounded-md p-3 space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Duration:</span>
                            <span className="text-gray-300">{formatDuration(videoData.metadata.duration)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Dimensions:</span>
                            <span className="text-gray-300">
                                {videoData.metadata.width} × {videoData.metadata.height}
                            </span>
                        </div>
                        {videoData.metadata.frameRate && (
                            <div className="flex justify-between text-xs">
                                <span className="text-gray-400">Frame Rate:</span>
                                <span className="text-gray-300">{videoData.metadata.frameRate} FPS</span>
                            </div>
                        )}
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Format:</span>
                            <span className="text-gray-300">{videoData.metadata.format.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Size:</span>
                            <span className="text-gray-300">{(videoData.metadata.size / 1024).toFixed(1)} KB</span>
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
