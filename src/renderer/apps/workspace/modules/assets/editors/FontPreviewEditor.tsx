import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useTranslation } from "@/lib/i18n";
import { ASSET_UNDECODABLE } from "@/lib/workspace/services/assets/assetReadFailure";
import { useAssetBlobUrl } from "./useAssetBlobUrl";
import { useAssetReadNotice, type AssetReadFailure } from "./useAssetReadNotice";

/** A font file that was read and that the browser would not load as a face. */
const UNDECODABLE_FONT: AssetReadFailure = { code: ASSET_UNDECODABLE };

interface FontPreviewPayload {
    asset: Asset<AssetType.Font>;
}

const SAMPLE_SIZES = [32, 24, 18, 14, 12];

/**
 * Font preview: loads the file as a FontFace under a tab-unique family name and renders sample
 * lines (Latin + CJK + digits) at several sizes, plus a free-typing line.
 */
export function FontPreviewEditor({ tabId, payload }: EditorComponentProps<FontPreviewPayload>) {
    const { t } = useTranslation();
    const asset = payload?.asset;
    const { url, loading, failure } = useAssetBlobUrl(asset);
    const [family, setFamily] = useState<string | null>(null);
    const [fontFailure, setFontFailure] = useState<AssetReadFailure | null>(null);
    const notice = useAssetReadNotice(asset?.id, failure ?? fontFailure);
    const [sampleText, setSampleText] = useState("");

    useEffect(() => {
        if (!url || !asset) {
            return;
        }
        // Unique per tab so two previews of different fonts never collide.
        const familyName = `nl-font-preview-${tabId.replace(/[^a-z0-9-]/gi, "-")}`;
        const face = new FontFace(familyName, `url(${url})`);
        let cancelled = false;
        face.load()
            .then(loaded => {
                if (cancelled) {
                    return;
                }
                document.fonts.add(loaded);
                setFamily(familyName);
                setFontFailure(null);
            })
            .catch(cause => {
                if (!cancelled) {
                    // The browser's reason is English and says nothing an author can act on
                    // beyond "this file is not a font it can use", which the notice says.
                    console.warn(`[assets] could not load ${asset.id} as a font`, cause);
                    setFontFailure(UNDECODABLE_FONT);
                }
            });
        return () => {
            cancelled = true;
            document.fonts.delete(face);
            setFamily(null);
        };
    }, [url, asset?.id, tabId]);

    if (!asset) {
        return null;
    }
    if (loading || (!family && !notice)) {
        return (
            <div className="flex h-full items-center justify-center text-fg-subtle">
                <Loader2 className="h-5 w-5 animate-spin" />
            </div>
        );
    }
    if (notice) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
                <AlertCircle className="h-5 w-5 text-danger" />
                <span>{notice}</span>
            </div>
        );
    }

    const sample = sampleText || t("assets.fontPreview.sampleText");

    return (
        <div className="h-full overflow-y-auto bg-surface px-6 py-5">
            <div className="mb-4 flex items-center gap-3">
                <span className="text-sm font-medium text-fg">{asset.name}</span>
            </div>
            <input
                type="text"
                value={sampleText}
                onChange={event => setSampleText(event.target.value)}
                placeholder={t("assets.fontPreview.typePlaceholder")}
                className="mb-5 w-full max-w-xl rounded-md border border-edge bg-surface-raised px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-primary/50"
            />
            <div className="space-y-4">
                {SAMPLE_SIZES.map(size => (
                    <div key={size} className="flex items-baseline gap-4">
                        <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-fg-subtle">{size}</span>
                        <div
                            className="min-w-0 truncate text-fg"
                            style={{ fontFamily: family ?? undefined, fontSize: size, lineHeight: 1.4 }}
                        >
                            {sample}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
