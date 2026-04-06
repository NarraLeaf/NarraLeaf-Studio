import type { UIElement } from "@shared/types/ui-editor/document";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { getProps, normalizeImageFill } from "@/lib/ui-editor/widget-modules/builtin/rectangle/helpers";
import { getImageProps } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import { imageWidgetPropsToImageFill } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import type { UISurfaceDiagnostic } from "../types";

function imageFillMissingAsset(fill: ImageFill | undefined): boolean {
    if (!fill) {
        return false;
    }
    const mode = fill.mode;
    if (mode === "crop" || mode === "cover" || mode === "contain" || mode === "stretch" || mode === "tile") {
        return !fill.assetId?.trim();
    }
    return false;
}

export function collectResourceDiagnostics(elements: UIElement[]): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];
    for (const el of elements) {
        if (el.type === "nl.image") {
            const props = getImageProps(el);
            const fill = imageWidgetPropsToImageFill(props);
            if (imageFillMissingAsset(fill)) {
                out.push({
                    id: `res:image:${el.id}`,
                    severity: "warning",
                    source: "resource",
                    message: `Image widget “${el.name ?? el.id}” has no image asset`,
                    hint: "Assign an image asset in the inspector.",
                    elementId: el.id,
                });
            }
        }
        if (el.type === "nl.rectangle") {
            const p = getProps(el);
            if (p.fillType === "image") {
                const fill = normalizeImageFill(p);
                if (imageFillMissingAsset(fill)) {
                    out.push({
                        id: `res:rect-image:${el.id}`,
                        severity: "warning",
                        source: "resource",
                        message: `Rectangle “${el.name ?? el.id}” uses image fill without an asset`,
                        hint: "Pick an image asset or switch fill type.",
                        elementId: el.id,
                    });
                }
            }
        }
    }
    return out;
}
