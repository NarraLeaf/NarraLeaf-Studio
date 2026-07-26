import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";

type Size = { width: number; height: number };

function Layer(props: { assetId: string | null; index: number; onMeasured: (index: number, size: Size) => void }) {
    const { url } = useAssetObjectUrl(props.assetId);
    const { index, onMeasured } = props;
    const handleLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget;
        onMeasured(index, { width: image.naturalWidth, height: image.naturalHeight });
    }, [index, onMeasured]);

    if (!url) {
        return null;
    }
    // Every layer of a stack shares the canvas and is drawn at the same origin, which is what keeps
    // them aligned - the rule the engine renders by. A layer of a different pixel size is therefore
    // misaligned here exactly as it would be in the game, rather than being quietly fitted to match.
    return (
        <img
            src={url}
            alt=""
            draggable={false}
            onLoad={handleLoad}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ zIndex: props.index }}
        />
    );
}

/**
 * What the character actually looks like: the layers composited in stacking order, bottom first.
 *
 * A preset character passes its single sprite through the same path - one layer is still a stack -
 * so the two kinds share one preview surface rather than growing two that can disagree.
 *
 * Sizes are measured off the decoded bitmaps rather than read from asset metadata, which does not
 * carry them. That also means the check is against what is really drawn. It matters because the
 * canvas is a hard constraint rather than a preference: the engine scales each layer independently
 * under autoFit, so a layer of a different size is not slightly out of place, it is stretched to the
 * stage on its own.
 */
export function LayerStackPreview(props: {
    /** Bottom to top; `null` entries are layers that draw nothing under the current tags. */
    assetIds: (string | null)[];
    canvas: { width: number; height: number } | null;
}) {
    const { t } = useTranslation();
    const [sizes, setSizes] = useState<Record<number, Size>>({});

    const onMeasured = useCallback((index: number, size: Size) => {
        setSizes(current => (
            current[index]?.width === size.width && current[index]?.height === size.height
                ? current
                : { ...current, [index]: size }
        ));
    }, []);

    const drawn = useMemo(
        () => props.assetIds.filter((assetId): assetId is string => Boolean(assetId)),
        [props.assetIds],
    );

    // With no declared canvas the first measured layer is the reference: a stack is consistent or it
    // is not, and saying so needs no author input.
    const reference = props.canvas ?? Object.values(sizes)[0] ?? null;
    const mismatched = reference
        ? Object.entries(sizes).filter(([, size]) => size.width !== reference.width || size.height !== reference.height)
        : [];

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 border-b border-edge px-4 py-2 text-xs text-fg-muted">
                <span>{reference ? `${reference.width} × ${reference.height}` : t("characters.editor.noCanvas")}</span>
                <span>{t("characters.editor.layerCount", { count: drawn.length })}</span>
                {mismatched.length > 0 && (
                    <span className="text-danger">
                        {t("characters.editor.canvasMismatch", {
                            list: mismatched.map(([, size]) => `${size.width}×${size.height}`).join(", "),
                        })}
                    </span>
                )}
            </div>
            <div className="relative flex-1 overflow-hidden bg-surface">
                {drawn.length === 0 ? (
                    <div className="grid h-full place-items-center text-sm text-fg-subtle">
                        {t("characters.preview.placeholder")}
                    </div>
                ) : (
                    props.assetIds.map((assetId, index) => (
                        <Layer
                            key={`${index}:${assetId ?? "none"}`}
                            assetId={assetId}
                            index={index}
                            onMeasured={onMeasured}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
