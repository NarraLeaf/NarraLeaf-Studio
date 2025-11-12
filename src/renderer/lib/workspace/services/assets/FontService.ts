import { AssetData, AssetType, FontAssetMetadata } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { FileSystemService } from "../core/FileSystem";

export class FontService {
    constructor(private filesystemService: FileSystemService) {}

    public async readLocalFont(path: string): Promise<RequestStatus<AssetData<AssetType.Font>>> {
        // Read font file as buffer
        const fileResult = await this.filesystemService.readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read font file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        const buffer = fileResult.data;
        const size = buffer.byteLength;

        // Get format from file extension
        const format = this.detectFontFormat(path);

        // Try to extract font metadata (basic support)
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
        } catch (error) {
            // Return with minimal metadata if parsing fails
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

    private detectFontFormat(path: string): string {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext || 'unknown';
    }
}

