import { AssetData, AssetType } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { Asset } from "./types";
import { AssetServiceBase } from "./AssetServiceBase";
export class OtherService extends AssetServiceBase {


    public async readLocalOther(asset: Asset<AssetType.Other>): Promise<RequestStatus<AssetData<AssetType.Other>>> {
        const path = this.getAssetPath(asset.id);
        const fileResult = await this.getFileSystemService().readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        return this.readOtherFromBuffer(asset, fileResult.data);
    }

    public async readOtherFromBuffer(asset: Asset<AssetType.Other>, buffer: Uint8Array): Promise<RequestStatus<AssetData<AssetType.Other>>> {
        const size = buffer.byteLength;
        const mimeType = this.detectMimeType(asset.name);

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


    private detectMimeType(filename: string): string | undefined {
        const parts = filename.split('.');
        const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
        
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

