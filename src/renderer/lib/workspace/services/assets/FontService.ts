import { AssetData, AssetType, FontAssetMetadata } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { Asset } from "./types";
import { AssetServiceBase } from "./AssetServiceBase";

export class FontService extends AssetServiceBase {

    public async readLocalFont(asset: Asset<AssetType.Font>): Promise<RequestStatus<AssetData<AssetType.Font>>> {
        const path = this.getAssetPath(asset.id);
        const fileResult = await this.getFileSystemService().readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read font file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        return this.readFontFromBuffer(asset, fileResult.data);
    }

    public async readFontFromBuffer(asset: Asset<AssetType.Font>, buffer: Uint8Array): Promise<RequestStatus<AssetData<AssetType.Font>>> {
        const size = buffer.byteLength;
        const format = this.detectFontFormat(asset);

        try {
            const metadata = await this.getFontMetadata(buffer, format);

            return {
                success: true,
                data: {
                    data: buffer,
                    metadata: {
                        ...metadata,
                        format,
                        size,
                    },
                },
            };
        } catch (_error) {
            return {
                success: true,
                data: {
                    data: buffer,
                    metadata: {
                        format,
                        size,
                    },
                },
            };
        }
    }


    private async getFontMetadata(buffer: Uint8Array, format: string): Promise<Partial<Omit<FontAssetMetadata, 'format' | 'size'>>> {
        // Font metadata extraction is complex and requires parsing font tables
        // For now, we'll return empty metadata
        // In the future, can use libraries like opentype.js for detailed parsing
        return {};
    }

    private detectFontFormat(asset: Asset): string {
        return asset.ext ?? this.detectFromName(asset.name);
    }

    private detectFromName(name: string): string {
        const parts = name.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'unknown';
    }
}

