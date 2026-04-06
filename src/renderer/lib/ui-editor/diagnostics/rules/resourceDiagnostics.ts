import type { UIElement } from "@shared/types/ui-editor/document";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { getImageWidgetRectangleProps } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import { getRectangleLikeProps, normalizeImageFill } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
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
            const props = getImageWidgetRectangleProps(el);
            if (props.fillType !== "image") {
                continue;
            }
            const fill = normalizeImageFill(props);
            if (imageFillMissingAsset(fill) && !props.backgroundImage?.trim()) {
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
        if (el.type === "nl.container") {
            const p = getRectangleLikeProps(el);
            if (p.fillType === "image") {
                const fill = normalizeImageFill(p);
                if (imageFillMissingAsset(fill)) {
                    out.push({
                        id: `res:container-image:${el.id}`,
                        severity: "warning",
                        source: "resource",
                        message: `Container “${el.name ?? el.id}” uses image fill without an asset`,
                        hint: "Pick an image asset or switch fill type.",
                        elementId: el.id,
                    });
                }
            }
        }
    }
    return out;
}
