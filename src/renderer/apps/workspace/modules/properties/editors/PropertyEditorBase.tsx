import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";

/**
 * Base properties for all property editors
 */
export interface PropertyEditorProps<T extends AssetType> {
    asset: Asset<T>;
    onChange?: (asset: Asset<T>) => void;
}

