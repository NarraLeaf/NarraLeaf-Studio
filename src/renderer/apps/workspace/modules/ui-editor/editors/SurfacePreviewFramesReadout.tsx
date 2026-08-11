import { useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
import type {
    SafeAreaMobileOrientation,
    SurfacePreviewFit,
    SurfacePreviewSize,
} from "@/lib/ui-editor/preview/surfacePreviewFrames";
import { computeSafeAreaFrameById, getSafeAreaPreset } from "@/lib/ui-editor/preview/surfacePreviewFrames";

type Props = {
    designSize: SurfacePreviewSize;
    aspectId: string | null;
    safeAreaId: string | null;
    mobileOrientation?: SafeAreaMobileOrientation | null;
    stageFit?: SurfacePreviewFit;
};

/**
 * What the canvas reference frames currently say, in words and numbers.
 *
 * Mount **outside** the zoomed canvas node: everything the frames draw lives in design space and
 * scales with the zoom, which is fine for geometry and useless for text.
 *
 * This is not decoration. A device preset resolves to zero insets whenever the letterbox bars are
 * thicker than the notch, and "no inset" and "no preset" draw the same canvas — so without a line
 * of text the most valuable answer the feature can give ("this device is fine") is indistinguishable
 * from the feature being off.
 */
export function SurfacePreviewFramesReadout({ designSize, aspectId, safeAreaId, mobileOrientation, stageFit }: Props) {
    const { t } = useTranslation();

    const safeFrame = useMemo(
        () => computeSafeAreaFrameById(designSize, safeAreaId, mobileOrientation, stageFit),
        [designSize, safeAreaId, mobileOrientation, stageFit],
    );
    const preset = getSafeAreaPreset(safeAreaId);

    const parts: string[] = [];
    if (aspectId) {
        parts.push(aspectId);
    }
    if (preset && safeFrame) {
        const insets = safeFrame.fullySafe
            ? t("uiEditor.preview.noOverlap")
            : (["top", "right", "bottom", "left"] as const)
                  .filter(edge => safeFrame.insets[edge] > 0)
                  // Rounded: these are millimetre-accurate device numbers projected through a fit
                  // scale, and a fractional design pixel is not a number anyone acts on.
                  .map(edge => `${t(`uiEditor.preview.inset.${edge}`)} ${Math.round(safeFrame.insets[edge])}`)
                  .join("  ");
        parts.push(`${preset.reference} · ${insets}`);
    }

    if (parts.length === 0) {
        return null;
    }

    return (
        <div
            data-surface-preview-readout
            className="pointer-events-none absolute bottom-3 right-3 z-20 rounded-md border border-edge-strong bg-surface-canvas/80 px-2 py-1 text-2xs tabular-nums text-fg-muted"
        >
            {parts.join("  ·  ")}
        </div>
    );
}
