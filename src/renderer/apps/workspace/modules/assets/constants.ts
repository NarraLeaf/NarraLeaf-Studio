import {
    Image,
    Music,
    Video,
    FileJson,
    Type,
    File,
} from "lucide-react";
import { ComponentType } from "react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";

export const ASSET_TYPE_ICONS: Record<AssetType, ComponentType<any>> = {
    [AssetType.Image]: Image,
    [AssetType.Audio]: Music,
    [AssetType.Video]: Video,
    [AssetType.JSON]: FileJson,
    [AssetType.Font]: Type,
    [AssetType.Other]: File,
};

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
    [AssetType.Image]: "Images",
    [AssetType.Audio]: "Audio",
    [AssetType.Video]: "Videos",
    [AssetType.JSON]: "JSON Files",
    [AssetType.Font]: "Fonts",
    [AssetType.Other]: "Other",
};
