import {
  Image,
  Music,
  Video,
  FileJson,
  Workflow,
  Type,
  Boxes,
  File,
  Clapperboard,
  Database
} from "lucide-react";
import { ComponentType } from "react";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";

/** Per-asset marks — the glyph on a row or a grid tile, which still names the file's own type. */
export const ASSET_TYPE_ICONS: Record<AssetType, ComponentType<any>> = {
  [AssetType.Image]: Image,
  [AssetType.Audio]: Music,
  [AssetType.Video]: Video,
  [AssetType.JSON]: FileJson,
  [AssetType.Blueprint]: Workflow,
  [AssetType.Font]: Type,
  [AssetType.Model]: Boxes,
  [AssetType.Other]: File
};

/**
 * Section marks — the glyph beside a sidebar heading.
 *
 * Separate from {@link ASSET_TYPE_ICONS} on purpose: a merged section cannot borrow one member's
 * mark without claiming the section is that member (a note for "Media" reads as "Audio"), and a row
 * inside it must keep showing what the file actually is.
 */
export const ASSET_CATEGORY_ICONS: Record<AssetCategory, ComponentType<any>> = {
  [AssetCategory.Image]: Image,
  [AssetCategory.Media]: Clapperboard,
  [AssetCategory.Data]: Database,
  [AssetCategory.Font]: Type,
  [AssetCategory.Model]: Boxes,
  [AssetCategory.Other]: File
};

// Section labels are localized at render: `t(`assets.categories.${category}`)`; per-type labels,
// where a type still names itself, use `t(`assets.types.${type}`)`. Both enums' values double as
// the catalog key segment.
