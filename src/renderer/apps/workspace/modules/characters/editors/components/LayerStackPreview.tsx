import { useCallback } from "react";
import { useTranslation } from "@/lib/i18n";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import type { LayerSize } from "@/lib/workspace/services/character/characterDiagnostics";

/** One slot of the stack: which layer it is, and what that layer draws right now. */
export type PreviewLayer = { id: string; assetId: string | null };

function Layer(props: {
  layer: PreviewLayer;
  index: number;
  ghost?: boolean;
  onMeasured: (layerId: string, size: LayerSize) => void;
}) {
  const { url } = useAssetObjectUrl(props.layer.assetId);
  const { layer, ghost, onMeasured } = props;
  // Only the live stack reports sizes. A ghost is the same layer under a *different* tag, so
  // letting it measure would make the canvas check flip between two answers for one layer.
  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      if (ghost) return;
      const image = event.currentTarget;
      onMeasured(layer.id, { width: image.naturalWidth, height: image.naturalHeight });
    },
    [ghost, layer.id, onMeasured]
  );

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
      style={{ zIndex: props.index, opacity: props.ghost ? 0.3 : undefined }}
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
 * carry them, and reported upwards because the canvas check is a diagnostic rather than a caption.
 * It matters because the canvas is a hard constraint rather than a preference: the engine scales
 * each layer independently under autoFit, so a layer of a different size is not slightly out of
 * place, it is stretched to the stage on its own.
 *
 * `onion` is the same stack under a different tag, drawn faint *below* the live one. Below rather
 * than above so the thing being aligned stays readable; it is a registration aid, not a blend.
 */
export function LayerStackPreview(props: {
  /** Bottom to top; entries whose `assetId` is null draw nothing under the current tags. */
  layers: PreviewLayer[];
  onion?: PreviewLayer[] | null;
  canvas: { width: number; height: number } | null;
  sizes: Record<string, LayerSize>;
  onMeasured: (layerId: string, size: LayerSize) => void;
  /**
   * What the header says about the picture. Omit for the layer count, which is the right answer
   * only for a kind that has layers — a preset character's single finished sprite was being
   * reported as "1 drawn", teaching a vocabulary that does not apply to it and saying nothing
   * about which of its poses is on screen. Pass `null` for no caption at all.
   */
  caption?: React.ReactNode;
  /** Drawn over the stack — the portrait crop box, which has to sit on the picture it frames. */
  overlay?: React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const drawn = props.layers.filter((layer) => layer.assetId);
  // Same stand-in the diagnostics use when no canvas is declared, so the two never disagree.
  const reference =
    props.canvas ??
    props.layers
      .map((layer) => props.sizes[layer.id])
      .filter(Boolean)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0] ??
    null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge px-4 py-2 text-xs text-fg-muted">
        {/* No canvas declared: the readout is simply absent. The Set canvas button sits in
                    this same toolbar, so a sentence saying there is no canvas yet would only be
                    naming the button beside it. */}
        {reference ? <span>{`${reference.width} × ${reference.height}`}</span> : null}
        {props.caption === undefined ? (
          <span>{t("characters.editor.layerCount", { count: drawn.length })}</span>
        ) : props.caption ? (
          <span className="truncate">{props.caption}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">{props.toolbar}</div>
      </div>
      <div className="relative flex-1 overflow-hidden bg-surface">
        {drawn.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-fg-subtle">
            {t("characters.preview.placeholder")}
          </div>
        ) : (
          <>
            {(props.onion ?? []).map((layer, index) => (
              <Layer
                key={`onion:${layer.id}:${layer.assetId ?? "none"}`}
                layer={layer}
                index={index}
                ghost
                onMeasured={props.onMeasured}
              />
            ))}
            {props.layers.map((layer, index) => (
              <Layer
                key={`${layer.id}:${layer.assetId ?? "none"}`}
                layer={layer}
                index={(props.onion?.length ?? 0) + index}
                onMeasured={props.onMeasured}
              />
            ))}
          </>
        )}
        {/* Above every layer, whatever the stack's depth: each `Layer` carries an explicit
                    z-index, so a later sibling would otherwise still sit under a tall stack. */}
        {props.overlay ? (
          <div className="absolute inset-0" style={{ zIndex: 1000 }}>
            {props.overlay}
          </div>
        ) : null}
      </div>
    </div>
  );
}
