import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { ASSET_TYPE_ICONS } from "../constants";
import { useBadgeImageUrl } from "../../story/scene-editor/storyBadgeImageCache";

/**
 * One asset, pictured, from the shared refcounted image cache.
 *
 * `object-contain` rather than `cover`: this exists so a reader recognises the asset, and a cropped
 * centre of a wide background is not recognisable. Until the bytes arrive the box stays empty rather
 * than flashing a glyph, which would read as "this asset has no picture" for the frame it is up.
 *
 * Everything that is not an image falls back to its category mark — deliberately *not* inside a
 * picture frame at the call sites that draw one, so nothing pretends to be a thumbnail it is not.
 * A waveform or a first frame replaces the mark per type; a generic file glyph never stands in.
 */
export function AssetThumbnail({ asset, className = "" }: { asset: Asset; className?: string }) {
  const Icon = ASSET_TYPE_ICONS[asset.type];
  const url = useBadgeImageUrl(
    asset.type === AssetType.Image
      ? { kind: "thumbnail", asset: asset as Asset<AssetType.Image> }
      : null
  );

  if (asset.type !== AssetType.Image) {
    return (
      <span className={`flex items-center justify-center ${className}`}>
        <Icon className="h-1/2 w-1/2 text-fg-muted" />
      </span>
    );
  }
  if (!url) {
    return <span className={className} />;
  }
  return <img src={url} alt="" draggable={false} className={`${className} object-contain`} />;
}
