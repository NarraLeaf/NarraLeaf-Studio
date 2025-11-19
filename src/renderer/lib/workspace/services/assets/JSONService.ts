import { AssetData, AssetType } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetServiceBase } from "./AssetServiceBase";

export class JSONService extends AssetServiceBase {

    public async readLocalJSON(path: string): Promise<RequestStatus<AssetData<AssetType.JSON>>> {
        // Read JSON file
        const fileResult = await this.getFileSystemService().read(path, "utf-8");
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read JSON file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        const content = fileResult.data;
        const size = new Blob([content]).size;

        try {
            // Parse JSON
            const data = JSON.parse(content);

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

