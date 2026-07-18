import { AlertCircle, Loader2 } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useTranslation } from "@/lib/i18n";
import { useAssetBlobUrl } from "./useAssetBlobUrl";

interface VideoPreviewPayload {
    asset: Asset<AssetType.Video>;
}

/** Video preview: native playback controls plus the asset's recorded metadata. */
export function VideoPreviewEditor({ payload }: EditorComponentProps<VideoPreviewPayload>) {
    const { t } = useTranslation();
    const asset = payload?.asset;
    const { url, loading, error } = useAssetBlobUrl(asset, "video/mp4");

    if (!asset) {
        return null;
    }
    if (loading) {
        return (
            <div className="flex h-full items-center justify-center text-fg-subtle">
                <Loader2 className="h-5 w-5 animate-spin" />
            </div>
        );
    }
    if (error || !url) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
                <AlertCircle className="h-5 w-5 text-danger" />
                <span>{error ?? t("assets.previewEditor.loadFailed")}</span>
            </div>
        );
    }

    const metadata = asset.meta as { width?: number; height?: number; duration?: number } | undefined;

    return (
        <div className="flex h-full flex-col bg-surface">
            <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                <video src={url} controls className="max-h-full max-w-full rounded-md bg-black" />
            </div>
            <div className="flex shrink-0 items-center gap-4 border-t border-edge px-4 py-2 text-xs text-fg-subtle">
                <span className="truncate">{asset.name}</span>
                {metadata?.width && metadata?.height && (
                    <span className="tabular-nums">{metadata.width}×{metadata.height}</span>
                )}
            </div>
        </div>
    );
}
