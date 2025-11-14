import { AssetExtensions, AssetType } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";

export type FileFormatValidationResult = {
    success: true;
    data: void;
    error?: never;
} | {
    success: false;
    data?: never;
    error?: string;
};

/**
 * Service for validating file formats based on content and extensions
 */
export class FileFormatValidator {
    /**
     * Validate file format by checking magic bytes and extension consistency
     */
    public async validateFileFormat(type: AssetType, path: string, buffer: Uint8Array): Promise<FileFormatValidationResult> {
        const fileExt = path.split('.').pop()?.toLowerCase() || '';

        // Check if file extension is in the allowed list for this asset type
        const allowedExtensions = AssetExtensions[type];
        if (!allowedExtensions.includes(fileExt)) {
            return {
                success: false,
                error: `File extension .${fileExt} is not allowed for ${type} assets. Allowed extensions: ${allowedExtensions.join(', ')}`,
            };
        }

        let detectedFormat: string | null = null;

        // Detect format based on asset type
        switch (type) {
            case AssetType.Image:
                detectedFormat = this.detectImageFormat(buffer);
                break;
            case AssetType.Audio:
                detectedFormat = this.detectAudioFormat(buffer);
                break;
            case AssetType.Video:
                detectedFormat = this.detectVideoFormat(buffer);
                break;
            case AssetType.Font:
                detectedFormat = this.detectFontFormat(buffer);
                break;
            case AssetType.JSON:
                // JSON validation through parsing
                try {
                    const text = new TextDecoder().decode(buffer);
                    JSON.parse(text);
                    return { success: true, data: void 0 };
                } catch {
                    return {
                        success: false,
                        error: 'Invalid JSON file',
                    };
                }
            case AssetType.Other:
                // No validation for other types (extension check is sufficient)
                return { success: true, data: void 0 };
        }

        // If format was detected, verify it matches the file extension
        if (detectedFormat && detectedFormat !== 'unknown') {
            const formatMatches = this.checkFormatMatch(type, fileExt, detectedFormat);
            if (!formatMatches) {
                return {
                    success: false,
                    error: `File format mismatch: file extension is .${fileExt.toUpperCase()} but file content indicates ${detectedFormat.toUpperCase()} format. The file may be corrupted or misnamed.`,
                };
            }
        }

        return { success: true, data: void 0 };
    }

    private detectImageFormat(buffer: Uint8Array): string | null {
        if (buffer.length < 4) return null;

        // JPEG
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
            return 'jpeg';
        }

        // PNG
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            return 'png';
        }

        // GIF
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
            return 'gif';
        }

        // WebP
        if (buffer.length >= 12) {
            const riffStr = String.fromCharCode(...buffer.subarray(0, 4));
            const webpStr = String.fromCharCode(...buffer.subarray(8, 12));
            if (riffStr === 'RIFF' && webpStr === 'WEBP') {
                return 'webp';
            }
        }

        // BMP
        if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
            return 'bmp';
        }

        // TIFF
        if ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) ||
            (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)) {
            return 'tiff';
        }

        return 'unknown';
    }

    private detectAudioFormat(buffer: Uint8Array): string | null {
        if (buffer.length < 12) return null;

        // MP3
        if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
            return 'mp3';
        }
        if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) {
            return 'mp3';
        }

        // WAV
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
            return 'wav';
        }

        // OGG
        if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
            return 'ogg';
        }

        // FLAC
        if (buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43) {
            return 'flac';
        }

        // M4A/AAC
        if (buffer.length >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 &&
            buffer[6] === 0x79 && buffer[7] === 0x70) {
            return 'm4a';
        }

        return 'unknown';
    }

    private detectVideoFormat(buffer: Uint8Array): string | null {
        if (buffer.length < 12) return null;

        // MP4/M4V
        if (buffer.length >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 &&
            buffer[6] === 0x79 && buffer[7] === 0x70) {
            if (buffer.length >= 12) {
                const brand = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
                if (brand === 'M4V ' || brand === 'M4VH' || brand === 'M4VP') {
                    return 'm4v';
                }
                if (brand === 'qt  ') {
                    return 'mov';
                }
            }
            return 'mp4';
        }

        // WebM/MKV
        if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
            return 'webm'; // Could also be mkv, but webm is more common in web contexts
        }

        // AVI
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x41 && buffer[9] === 0x56 && buffer[10] === 0x49 && buffer[11] === 0x20) {
            return 'avi';
        }

        return 'unknown';
    }

    private detectFontFormat(buffer: Uint8Array): string | null {
        if (buffer.length < 4) return null;

        // TTF
        if (buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00) {
            return 'ttf';
        }

        // OTF
        if (buffer[0] === 0x4F && buffer[1] === 0x54 && buffer[2] === 0x54 && buffer[3] === 0x4F) {
            return 'otf';
        }

        // WOFF
        if (buffer[0] === 0x77 && buffer[1] === 0x4F && buffer[2] === 0x46 && buffer[3] === 0x46) {
            return 'woff';
        }

        // WOFF2
        if (buffer[0] === 0x77 && buffer[1] === 0x4F && buffer[2] === 0x46 && buffer[3] === 0x32) {
            return 'woff2';
        }

        // EOT
        if (buffer.length >= 36 && buffer[34] === 0x4C && buffer[35] === 0x50) {
            return 'eot';
        }

        return 'unknown';
    }

    private checkFormatMatch(type: AssetType, extension: string, detectedFormat: string): boolean {
        const formatMaps: Record<AssetType, Record<string, string[]>> = {
            [AssetType.Image]: {
                'jpeg': ['jpg', 'jpeg', 'jpe', 'jfif'],
                'png': ['png'],
                'gif': ['gif'],
                'webp': ['webp'],
                'bmp': ['bmp', 'dib'],
                'tiff': ['tiff', 'tif'],
            },
            [AssetType.Audio]: {
                'mp3': ['mp3', 'mpeg'],
                'wav': ['wav', 'wave'],
                'ogg': ['ogg', 'oga'],
                'flac': ['flac'],
                'm4a': ['m4a', 'aac', 'mp4'],
            },
            [AssetType.Video]: {
                'mp4': ['mp4', 'm4v'],
                'm4v': ['m4v', 'mp4'],
                'webm': ['webm', 'mkv'],
                'avi': ['avi'],
                'mov': ['mov', 'qt'],
            },
            [AssetType.Font]: {
                'ttf': ['ttf'],
                'otf': ['otf'],
                'woff': ['woff'],
                'woff2': ['woff2'],
                'eot': ['eot'],
            },
            [AssetType.JSON]: {},
            [AssetType.Other]: {},
        };

        const formatMap = formatMaps[type];
        for (const [format, extensions] of Object.entries(formatMap)) {
            if (extensions.includes(detectedFormat) && extensions.includes(extension)) {
                return true;
            }
        }

        return false;
    }
}
