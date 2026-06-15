import type { SharedBlueprintAsset } from "@shared/types/blueprint/document";
import { AssetData, AssetType, BlueprintAssetMetadata } from "./assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetServiceBase } from "./AssetServiceBase";
import { parseSharedBlueprintAssetJson, SharedBlueprintAssetParseError } from "./blueprintAssetSchema";

export class BlueprintService extends AssetServiceBase {
    public async readLocalBlueprint(path: string): Promise<RequestStatus<AssetData<AssetType.Blueprint>>> {
        const fileResult = await this.getFileSystemService().read(path, "utf-8");
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read blueprint asset: ${fileResult.error.message || "Unknown error"}`,
            };
        }
        return this.readBlueprintFromText(fileResult.data);
    }

    public async readBlueprintFromBuffer(buffer: Uint8Array): Promise<RequestStatus<AssetData<AssetType.Blueprint>>> {
        const text = new TextDecoder("utf-8").decode(buffer);
        return this.readBlueprintFromText(text);
    }

    private readBlueprintFromText(content: string): RequestStatus<AssetData<AssetType.Blueprint>> {
        const size = new Blob([content]).size;
        try {
            const data: SharedBlueprintAsset = parseSharedBlueprintAssetJson(content);
            const metadata: BlueprintAssetMetadata = {
                size,
                isValid: true,
                schemaVersion: 1,
            };
            return { success: true, data: { data, metadata } };
        } catch (e) {
            const msg = e instanceof SharedBlueprintAssetParseError ? e.message : String(e);
            return {
                success: false,
                error: msg,
            };
        }
    }
}
