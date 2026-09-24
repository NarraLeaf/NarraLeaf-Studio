import { AssetData, AssetType, AudioAssetMetadata } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { Asset } from "./types";
import { AssetServiceBase } from "./AssetServiceBase";
import { ASSET_UNDECODABLE } from "./assetReadFailure";
import { readAudioHeader } from "./audioHeader";

export class AudioService extends AssetServiceBase {

    public async readLocalAudio(asset: Asset<AssetType.Audio>): Promise<RequestStatus<AssetData<AssetType.Audio>>> {
        const path = this.getAssetPath(asset.id);
        const fileResult = await this.getFileSystemService().readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read audio file: ${fileResult.error?.message || 'Unknown error'}`,
                code: fileResult.error?.code,
            };
        }

        return this.readAudioFromBuffer(asset, fileResult.data);
    }

    public async readAudioFromBuffer(asset: Asset<AssetType.Audio>, buffer: Uint8Array): Promise<RequestStatus<AssetData<AssetType.Audio>>> {
        const size = buffer.byteLength;

        try {
            const metadata = await this.getAudioMetadata(buffer, asset);

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
                code: ASSET_UNDECODABLE,
            };
        }
    }


    private async getAudioMetadata(buffer: Uint8Array, asset: Asset<AssetType.Audio>): Promise<Omit<AudioAssetMetadata, 'size'>> {
        return new Promise((resolve, reject) => {
            const blob = new Blob([new Uint8Array(buffer)]);
            const url = URL.createObjectURL(blob);
            const audio = new Audio();

            audio.onloadedmetadata = () => {
                URL.revokeObjectURL(url);

                // Get format from file extension
                const format = this.detectAudioFormat(asset);

                // The file's own rate and channel count, read from its header. A fresh context's rate
                // is the output device's, not the file's, so it is only the fallback for a container
                // the header reader does not know.
                const header = readAudioHeader(buffer);
                let deviceRate = 44100;
                try {
                    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                    deviceRate = audioContext.sampleRate;
                    void audioContext.close();
                } catch {
                    // No AudioContext; keep the common default.
                }
                resolve({
                    duration: audio.duration || 0,
                    sampleRate: header?.sampleRate ?? deviceRate,
                    channels: header?.channels ?? 2,
                    format,
                });
            };

            audio.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load audio'));
            };

            audio.src = url;
        });
    }

    private detectAudioFormat(asset: Asset): string {
        return asset.ext ?? this.detectFromName(asset.name);
    }

    private detectFromName(name: string): string {
        const parts = name.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'unknown';
    }
}

