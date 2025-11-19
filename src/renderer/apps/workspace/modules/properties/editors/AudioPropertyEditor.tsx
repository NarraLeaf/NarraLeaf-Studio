import { useState, useEffect } from "react";
import { Music } from "lucide-react";
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
                <div className="bg-[#1e1f22] rounded-md p-3 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                        <Music className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-300">Audio Info</span>
                    </div>
                    <div className="flex items-center justify-center bg-[#0f1115] rounded p-2">
                        <div className="text-xs text-gray-500 text-center">
                            {formatDuration(audioData.metadata.duration)}
                            <br />
                            {audioData.metadata.channels} channel{audioData.metadata.channels > 1 ? 's' : ''}
                            <br />
                            {audioData.metadata.sampleRate} Hz
                        </div>
                    </div>
                </div>
            )}

            {/* Technical Info (Read-only) */}
            {audioData && (
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        Audio Information
                    </label>
                    <div className="bg-[#1e1f22] border border-white/10 rounded-md p-3 space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Duration:</span>
                            <span className="text-gray-300">{formatDuration(audioData.metadata.duration)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Sample Rate:</span>
                            <span className="text-gray-300">{audioData.metadata.sampleRate} Hz</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Channels:</span>
                            <span className="text-gray-300">{audioData.metadata.channels}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Format:</span>
                            <span className="text-gray-300">{audioData.metadata.format.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Size:</span>
                            <span className="text-gray-300">{(audioData.metadata.size / 1024).toFixed(1)} KB</span>
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
