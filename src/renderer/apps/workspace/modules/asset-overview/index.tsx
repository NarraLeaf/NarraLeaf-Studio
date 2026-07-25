/**
 * Asset overview — the read-only reading of the asset library.
 *
 * No longer an editor module. The overview was a full-page tab with its own entry points (a sidebar
 * button and a palette command), which made the library two surfaces that never showed each other's
 * answer. It is now the assets panel's third view, mounted by `AssetsPanel` beside List and Icon.
 */
export { AssetOverviewView } from "./AssetOverviewView";
export { useAssetLibrarySnapshot } from "./useAssetLibrarySnapshot";
export { AssetOverviewCommand } from "./AssetOverviewCommand";
