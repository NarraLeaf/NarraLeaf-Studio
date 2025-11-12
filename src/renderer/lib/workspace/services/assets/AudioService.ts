import { AssetData, AssetType, AudioAssetMetadata } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { FileSystemService } from "../core/FileSystem";

export class AudioService {
    constructor(private filesystemService: FileSystemService) {}

    public async readLocalAudio(path: string): Promise<RequestStatus<AssetData<AssetType.Audio>>> {
        // Read audio file as buffer
        const fileResult = await this.filesystemService.readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read audio file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        const buffer = fileResult.data;
        const size = buffer.byteLength;

        // Get audio metadata using HTML Audio API
        try {
            const metadata = await this.getAudioMetadata(buffer, path);

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
                error: `Failed to parse audio metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
        }
    }

    private async getAudioMetadata(buffer: Uint8Array, path: string): Promise<Omit<AudioAssetMetadata, 'size'>> {
        return new Promise((resolve, reject) => {
            const blob = new Blob([new Uint8Array(buffer)]);
            const url = URL.createObjectURL(blob);
            const audio = new Audio();

            audio.onloadedmetadata = () => {
                URL.revokeObjectURL(url);

                // Get format from file extension
                const format = this.detectAudioFormat(path);

                // Get audio context for sample rate (if available)
                try {
                    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                    const sampleRate = audioContext.sampleRate;
                    audioContext.close();

                    resolve({
                        duration: audio.duration || 0,
                        sampleRate,
                        channels: 2, // Default, hard to detect without decoding
                        format,
                    });
                } catch {
                    // Fallback if AudioContext is not available
                    resolve({
                        duration: audio.duration || 0,
                        sampleRate: 44100, // Common default
                        channels: 2,
                        format,
                    });
                }
            };

            audio.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load audio'));
            };

            audio.src = url;
        });
    }

    private detectAudioFormat(path: string): string {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext || 'unknown';
    }
}

