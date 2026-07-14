import type { UIElement } from "@shared/types/ui-editor/document";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import { getButtonProps } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import {
    buttonResolvedVisualToRectangleLike,
    resolveImageRectangleLike,
    resolveButtonVisualProps,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { getRectangleLikeProps, normalizeImageFill } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { translate } from "@/lib/i18n";
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

function getImageDiagnosticProps(el: UIElement) {
    const rawAppearance = (el.props as { appearance?: unknown } | undefined)?.appearance;
    return resolveImageRectangleLike(el, isAppearanceModel(rawAppearance) ? rawAppearance : undefined, {
        variantOverrideId: null,
        signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    });
}

export function collectResourceDiagnostics(elements: UIElement[]): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];
    for (const el of elements) {
        if (el.type === "nl.image") {
            const props = getImageDiagnosticProps(el);
            if (props.fillType !== "image") {
                continue;
            }
            const fill = normalizeImageFill(props);
            if (imageFillMissingAsset(fill) && !props.backgroundImage?.trim()) {
                out.push({
                    id: `res:image:${el.id}`,
                    severity: "warning",
                    source: "resource",
                    message: translate("blueprint.diagnostics.resource.imageMissing", { name: el.name ?? el.type }),
                    hint: translate("blueprint.diagnostics.resource.imageMissingHint"),
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
                        message: translate("blueprint.diagnostics.resource.containerImageMissing", { name: el.name ?? el.type }),
                        hint: translate("blueprint.diagnostics.resource.containerImageMissingHint"),
                        elementId: el.id,
                    });
                }
            }
        }
        if (el.type === "nl.button") {
            const flat = getButtonProps(el);
            const signals = { ...DEFAULT_SYSTEM_INTERACTION_SIGNALS, disabled: Boolean(flat.interactionDisabled) };
            const v = resolveButtonVisualProps(el, flat.appearance ?? undefined, {
                variantOverrideId: null,
                signals,
            });
            if (v.fillType === "image") {
                const rl = buttonResolvedVisualToRectangleLike(v);
                const fill = normalizeImageFill(rl);
                if (imageFillMissingAsset(fill) && !rl.backgroundImage?.trim()) {
                    out.push({
                        id: `res:button-image:${el.id}`,
                        severity: "warning",
                        source: "resource",
                        message: translate("blueprint.diagnostics.resource.buttonImageMissing", { name: el.name ?? el.type }),
                        hint: translate("blueprint.diagnostics.resource.buttonImageMissingHint"),
                        elementId: el.id,
                    });
                }
            }
        }
    }
    return out;
}
