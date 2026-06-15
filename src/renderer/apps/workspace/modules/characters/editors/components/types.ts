import { AssetData, AssetType } from "@/lib/workspace/services/assets/assetTypes";

export type AssetView = {
    url: string;
    metadata?: AssetData<AssetType.Image>["metadata"];
};

