import { AssetData, AssetType } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { FileSystemService } from "../core/FileSystem";

export class OtherService {
    constructor(private filesystemService: FileSystemService) {}

    public async readLocalOther(path: string): Promise<RequestStatus<AssetData<AssetType.Other>>> {
        // Read file as buffer
        const fileResult = await this.filesystemService.readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        const buffer = fileResult.data;
        const size = buffer.byteLength;

        // Try to detect MIME type from file extension
        const mimeType = this.detectMimeType(path);

        return {
            success: true,
            data: {
                data: buffer,
                metadata: {
                    size,
                    mimeType,
                },
            },
        };
    }

    private detectMimeType(path: string): string | undefined {
        const ext = path.split('.').pop()?.toLowerCase();
        
        const mimeTypes: Record<string, string> = {
            txt: 'text/plain',
            html: 'text/html',
            css: 'text/css',
            js: 'application/javascript',
            ts: 'application/typescript',
            json: 'application/json',
            xml: 'application/xml',
            pdf: 'application/pdf',
            zip: 'application/zip',
            md: 'text/markdown',
            csv: 'text/csv',
        };

        return ext ? mimeTypes[ext] : undefined;
    }
}

