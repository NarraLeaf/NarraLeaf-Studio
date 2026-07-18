import { useMemo } from "react";
import { AlertCircle, Loader2, TriangleAlert } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useTranslation } from "@/lib/i18n";
import { useAssetBlobUrl } from "./useAssetBlobUrl";

interface JsonPreviewPayload {
    asset: Asset<AssetType.JSON>;
}

/** Pretty-printing beyond this many bytes would hang the tab; show raw head instead. */
const PRETTY_PRINT_LIMIT = 1_000_000;

/** JSON preview: pretty-printed read-only text; malformed files show raw content with a notice. */
export function JsonPreviewEditor({ payload }: EditorComponentProps<JsonPreviewPayload>) {
    const { t } = useTranslation();
    const asset = payload?.asset;
    const { bytes, loading, error } = useAssetBlobUrl(asset);

    const parsed = useMemo(() => {
        if (!bytes) {
            return null;
        }
        const text = new TextDecoder().decode(bytes);
        if (text.length > PRETTY_PRINT_LIMIT) {
            return { content: text.slice(0, PRETTY_PRINT_LIMIT), truncated: true, invalid: false };
        }
        try {
            return { content: JSON.stringify(JSON.parse(text), null, 2), truncated: false, invalid: false };
        } catch {
            return { content: text, truncated: false, invalid: true };
        }
    }, [bytes]);

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
    if (error || !parsed) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
                <AlertCircle className="h-5 w-5 text-danger" />
                <span>{error ?? t("assets.previewEditor.loadFailed")}</span>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-surface">
            {(parsed.invalid || parsed.truncated) && (
                <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-warning/10 px-4 py-1.5 text-xs text-warning">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    <span>
                        {parsed.invalid
                            ? t("assets.jsonPreview.invalid")
                            : t("assets.jsonPreview.truncated")}
                    </span>
                </div>
            )}
            <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-5 text-fg-muted">
                {parsed.content}
            </pre>
        </div>
    );
}
