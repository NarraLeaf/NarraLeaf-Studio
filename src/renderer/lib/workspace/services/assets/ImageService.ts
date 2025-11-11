import { AssetData, AssetType, ImageAssetMetadata } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { FileSystemService } from "../core/FileSystem";

export class ImageService {
    constructor(private filesystemService: FileSystemService) {}

    public async readLocalImage(path: string): Promise<RequestStatus<AssetData<AssetType.Image>>> {
        // Read image file as buffer
        const fileResult = await this.filesystemService.readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read image file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        const buffer = fileResult.data;
        const size = buffer.byteLength;

        // Get image metadata using HTML Image API
        try {
            const metadata = await this.getImageMetadata(buffer);

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
                error: `Failed to parse image metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
        }
    }

    private async getImageMetadata(buffer: Buffer): Promise<Omit<ImageAssetMetadata, 'size'>> {
        return new Promise((resolve, reject) => {
            const blob = new Blob([new Uint8Array(buffer)]);
            const url = URL.createObjectURL(blob);
            const img = new Image();

            img.onload = () => {
                URL.revokeObjectURL(url);

                // Get format from buffer magic bytes or fallback to file extension
                const format = this.detectImageFormat(buffer);

                resolve({
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                    format,
                });
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image'));
            };

            img.src = url;
        });
    }

    private detectImageFormat(buffer: Buffer): string {
        // Check magic bytes for common image formats
        if (buffer.length >= 4) {
            const header = buffer.subarray(0, 4);

            // JPEG
            if (header[0] === 0xFF && header[1] === 0xD8) {
                return 'jpeg';
            }

            // PNG
            if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
                return 'png';
            }

            // GIF
            if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
                return 'gif';
            }

            // WebP
            if (buffer.length >= 12) {
                const webpHeader = buffer.subarray(0, 12);
                if (webpHeader.toString('ascii', 0, 4) === 'RIFF' &&
                    webpHeader.toString('ascii', 8, 12) === 'WEBP') {
                    return 'webp';
                }
            }

            // BMP
            if (header[0] === 0x42 && header[1] === 0x4D) {
                return 'bmp';
            }

            // TIFF
            if ((header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2A && header[3] === 0x00) ||
                (header[0] === 0x4D && header[1] === 0x4D && header[2] === 0x00 && header[3] === 0x2A)) {
                return 'tiff';
            }
        }

        // Fallback to unknown
        return 'unknown';
    }
}
