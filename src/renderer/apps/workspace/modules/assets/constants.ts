import {
    Image,
    Music,
    Video,
    FileJson,
    Workflow,
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
    [AssetType.Blueprint]: Workflow,
    [AssetType.Font]: Type,
    [AssetType.Other]: File,
};

// Asset category labels are localized at render: `t(`assets.types.${type}`)`.
// The `AssetType` enum values double as the catalog key segment.
