import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, TriangleAlert } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { useTranslation } from "@/lib/i18n";

interface JsonPreviewPayload {
    asset: Asset<AssetType.JSON>;
}

/** Pretty-printing beyond this many characters would hang the tab; show the head instead. */
const PRETTY_PRINT_LIMIT = 1_000_000;

/**
 * JSON preview: pretty-printed, read-only.
 *
 * Unlike the other preview editors this one does not go through `useAssetBlobUrl` — a JSON
 * asset's `fetch()` resolves to the *parsed value*, not bytes (see `JSONService`), and decoding
 * that as text throws. Malformed files fail the fetch outright, so the parse error is what we
 * render; the importer rejects them before they can get this far.
 */
export function JsonPreviewEditor({ payload }: EditorComponentProps<JsonPreviewPayload>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const asset = payload?.asset;
    const [value, setValue] = useState<unknown>(undefined);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!context || !asset) {
            setLoading(false);
            return;
        }
        let mounted = true;
        setLoading(true);
        setError(null);
        void context.services
            .get<AssetsService>(Services.Assets)
            .fetch(asset)
            .then(result => {
                if (!mounted) {
                    return;
                }
                if (!result.success) {
                    setError(String(result.error ?? t("assets.previewEditor.loadFailed")));
                } else {
                    setValue(result.data.data);
                }
                setLoading(false);
            })
            .catch(fetchError => {
                if (mounted) {
                    setError(String(fetchError));
                    setLoading(false);
                }
            });
        return () => {
            mounted = false;
        };
    }, [context, asset?.id, asset?.hash]);

    const rendered = useMemo(() => {
        if (value === undefined) {
            return null;
        }
        const text = JSON.stringify(value, null, 2) ?? String(value);
        return text.length > PRETTY_PRINT_LIMIT
            ? { content: text.slice(0, PRETTY_PRINT_LIMIT), truncated: true }
            : { content: text, truncated: false };
    }, [value]);

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
    if (error || !rendered) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-fg-muted">
                <AlertCircle className="h-5 w-5 text-danger" />
                <span>{error ?? t("assets.previewEditor.loadFailed")}</span>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-surface">
            {rendered.truncated && (
                <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-warning/10 px-4 py-1.5 text-xs text-warning">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    <span>{t("assets.jsonPreview.truncated")}</span>
                </div>
            )}
            <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-5 text-fg-muted">
                {rendered.content}
            </pre>
        </div>
    );
}
