import { AssetData, AssetType } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetServiceBase } from "./AssetServiceBase";

export class JSONService extends AssetServiceBase {

    public async readLocalJSON(path: string): Promise<RequestStatus<AssetData<AssetType.JSON>>> {
        const fileResult = await this.getFileSystemService().read(path, "utf-8");
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read JSON file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        return this.readJSONFromText(fileResult.data);
    }

    public async readJSONFromBuffer(buffer: Uint8Array): Promise<RequestStatus<AssetData<AssetType.JSON>>> {
        const decoder = new TextDecoder("utf-8");
        return this.readJSONFromText(decoder.decode(buffer));
    }

    private async readJSONFromText(content: string): Promise<RequestStatus<AssetData<AssetType.JSON>>> {
        const size = new Blob([content]).size;

        try {
            // Same BOM tolerance as the import validator, so a file that passed import also reads.
            const data = JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content);

            return {
                success: true,
                data: {
                    data,
                    metadata: {
                        size,
                        isValid: true,
                    },
                },
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to parse JSON: ${error instanceof Error ? error.message : 'Invalid JSON'}`,
            };
        }
    }
}

