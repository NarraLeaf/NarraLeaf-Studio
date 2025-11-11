import { AssetData, AssetType, VideoAssetMetadata } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { FileSystemService } from "../core/FileSystem";

export class VideoService {
    constructor(private filesystemService: FileSystemService) {}

    public async readLocalVideo(path: string): Promise<RequestStatus<AssetData<AssetType.Video>>> {
        // Read video file as buffer
        const fileResult = await this.filesystemService.readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read video file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        const buffer = fileResult.data;
        const size = buffer.byteLength;

        // Get video metadata using HTML Video API
        try {
            const metadata = await this.getVideoMetadata(buffer, path);

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

    private async getVideoMetadata(buffer: Buffer, path: string): Promise<Omit<VideoAssetMetadata, 'size'>> {
        return new Promise((resolve, reject) => {
            const blob = new Blob([new Uint8Array(buffer)]);
            const url = URL.createObjectURL(blob);
            const video = document.createElement('video');

            video.onloadedmetadata = () => {
                URL.revokeObjectURL(url);

                // Get format from file extension
                const format = this.detectVideoFormat(path);

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

    private detectVideoFormat(path: string): string {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext || 'unknown';
    }
}

