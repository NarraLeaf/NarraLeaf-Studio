import type { UIElement } from "@shared/types/ui-editor/document";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { getProps, normalizeImageFill } from "../rectangle/helpers";
import type { RectangleProps } from "../rectangle/types";

function objectFitLegacyToMode(fit: unknown): ImageFill["mode"] {
    if (fit === "fill") return "stretch";
    if (fit === "contain") return "contain";
    if (fit === "cover") return "cover";
    return "cover";
}

/**
 * Rectangle-shaped props for nl.image, including legacy assetId / imageUrl / objectFit / imageOpacity.
 */
export function getImageWidgetRectangleProps(element: UIElement): RectangleProps {
    const base = getProps(element);
    const raw = (element.props ?? {}) as Record<string, unknown>;

    let next = base;

    const legacyAssetId =
        typeof raw.assetId === "string" && raw.assetId.trim() ? raw.assetId.trim() : "";
    const legacyUrl =
        typeof raw.imageUrl === "string" && raw.imageUrl.trim() ? raw.imageUrl.trim() : "";
    const fill = normalizeImageFill(base);
    const hasAssetInFill = Boolean(fill?.assetId?.trim());
    const hasBg = Boolean(base.backgroundImage?.trim());

    if (legacyAssetId && !hasAssetInFill && !hasBg) {
        const mode = objectFitLegacyToMode(raw.objectFit);
        next = {
            ...base,
            fillType: "image",
            imageFill: {
                mode,
                assetId: legacyAssetId,
                cropPlacement: fill?.cropPlacement ?? (raw.imageFill as ImageFill | undefined)?.cropPlacement,
            },
        };
    } else if (legacyUrl && !hasAssetInFill && !hasBg) {
        next = {
            ...base,
            fillType: "image",
            backgroundImage: legacyUrl,
        };
    }

    if (typeof raw.imageOpacity === "number" && Number.isFinite(raw.imageOpacity)) {
        if (raw.fillOpacity === undefined) {
            next = { ...next, fillOpacity: Math.max(0, Math.min(1, raw.imageOpacity)) };
        }
    }

    return next;
}
