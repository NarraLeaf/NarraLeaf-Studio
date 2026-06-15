import { AssetData, AssetType, VideoAssetMetadata } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { Asset } from "./types";
import { AssetServiceBase } from "./AssetServiceBase";

export class VideoService extends AssetServiceBase {

    public async readLocalVideo(asset: Asset<AssetType.Video>): Promise<RequestStatus<AssetData<AssetType.Video>>> {
        const path = this.getAssetPath(asset.id);
        const fileResult = await this.getFileSystemService().readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read video file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        return this.readVideoFromBuffer(asset, fileResult.data);
    }

    public async readVideoFromBuffer(asset: Asset<AssetType.Video>, buffer: Uint8Array): Promise<RequestStatus<AssetData<AssetType.Video>>> {
        const size = buffer.byteLength;

        try {
            const metadata = await this.getVideoMetadata(buffer, asset);

            return {
                success: true,
                data: {
                    data: buffer,
                    metadata: {
                        ...metadata,
                        size,
                    },
                },
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to parse video metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
        }
    }


    private async getVideoMetadata(buffer: Uint8Array, asset: Asset<AssetType.Video>): Promise<Omit<VideoAssetMetadata, 'size'>> {
        return new Promise((resolve, reject) => {
            const blob = new Blob([new Uint8Array(buffer)]);
            const url = URL.createObjectURL(blob);
            const video = document.createElement('video');

            video.onloadedmetadata = () => {
                URL.revokeObjectURL(url);

                // Get format from file extension
                const format = this.detectVideoFormat(asset);

                resolve({
                    duration: video.duration || 0,
                    width: video.videoWidth || 0,
                    height: video.videoHeight || 0,
                    format,
                });
            };

            video.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load video'));
            };

            video.src = url;
        });
    }

    private detectVideoFormat(asset: Asset): string {
        return asset.ext ?? this.detectFromName(asset.name);
    }

    private detectFromName(name: string): string {
        const parts = name.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'unknown';
    }
}

