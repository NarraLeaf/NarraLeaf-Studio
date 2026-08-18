import type { UIElement } from "@shared/types/ui-editor/document";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import { UI_VIDEO_ELEMENT_TYPE } from "@shared/types/ui-editor/video";
import { UI_PUPPET_ELEMENT_TYPE, isPuppetWidgetConfigured } from "@shared/types/ui-editor/puppet";
import { getButtonProps } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import { getVideoProps } from "@/lib/ui-editor/widget-modules/builtin/video/helpers";
import { getPuppetProps } from "@/lib/ui-editor/widget-modules/builtin/puppet/helpers";
import { SURFACE_PUPPET_CONTEXT_BUDGET } from "@/lib/ui-editor/runtime/game/surfacePuppetContextBudget";
import {
  buttonResolvedVisualToRectangleLike,
  resolveImageRectangleLike,
  resolveButtonVisualProps
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import {
  getRectangleLikeProps,
  normalizeImageFill
} from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { translate } from "@/lib/i18n";
import type { UISurfaceDiagnostic } from "../types";

function imageFillMissingAsset(fill: ImageFill | undefined): boolean {
  if (!fill) {
    return false;
  }
  const mode = fill.mode;
  if (
    mode === "crop" ||
    mode === "cover" ||
    mode === "contain" ||
    mode === "stretch" ||
    mode === "tile"
  ) {
    return !fill.assetId?.trim();
  }
  return false;
}

function getImageDiagnosticProps(el: UIElement) {
  const rawAppearance = (el.props as { appearance?: unknown } | undefined)?.appearance;
  return resolveImageRectangleLike(
    el,
    isAppearanceModel(rawAppearance) ? rawAppearance : undefined,
    {
      variantOverrideId: null,
      signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS
    }
  );
}

export function collectResourceDiagnostics(elements: UIElement[]): UISurfaceDiagnostic[] {
  const out: UISurfaceDiagnostic[] = [];
  let drawablePuppets = 0;
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
          message: translate("blueprint.diagnostics.resource.imageMissing", {
            name: el.name ?? el.type
          }),
          hint: translate("blueprint.diagnostics.resource.imageMissingHint"),
          elementId: el.id
        });
      }
    }
    if (el.type === UI_VIDEO_ELEMENT_TYPE) {
      // A video widget with no clip is an empty chrome box that looks like a styling choice.
      // The poster is genuinely optional, so its absence is not reported.
      if (!getVideoProps(el).assetId) {
        out.push({
          id: `res:video:${el.id}`,
          severity: "warning",
          source: "resource",
          message: translate("blueprint.diagnostics.resource.videoMissing", {
            name: el.name ?? el.type
          }),
          hint: translate("blueprint.diagnostics.resource.videoMissingHint"),
          elementId: el.id
        });
      }
    }
    if (el.type === UI_PUPPET_ELEMENT_TYPE) {
      const props = getPuppetProps(el);
      // Both halves are reported, and separately: a model with no runtime to draw it and a
      // runtime with no model are different mistakes with different fixes, and one message
      // covering both would name neither.
      if (!props.assetId) {
        out.push({
          id: `res:puppet:${el.id}`,
          severity: "warning",
          source: "resource",
          message: translate("blueprint.diagnostics.resource.puppetModelMissing", {
            name: el.name ?? el.type
          }),
          hint: translate("blueprint.diagnostics.resource.puppetModelMissingHint"),
          elementId: el.id
        });
      }
      if (props.backend.length === 0) {
        out.push({
          id: `res:puppet-backend:${el.id}`,
          severity: "warning",
          source: "resource",
          message: translate("blueprint.diagnostics.resource.puppetBackendMissing", {
            name: el.name ?? el.type
          }),
          hint: translate("blueprint.diagnostics.resource.puppetBackendMissingHint"),
          elementId: el.id
        });
      }
      if (isPuppetWidgetConfigured(props)) {
        drawablePuppets += 1;
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
            message: translate("blueprint.diagnostics.resource.containerImageMissing", {
              name: el.name ?? el.type
            }),
            hint: translate("blueprint.diagnostics.resource.containerImageMissingHint"),
            elementId: el.id
          });
        }
      }
    }
    if (el.type === "nl.button") {
      const flat = getButtonProps(el);
      const signals = {
        ...DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        disabled: Boolean(flat.interactionDisabled)
      };
      const v = resolveButtonVisualProps(el, flat.appearance ?? undefined, {
        variantOverrideId: null,
        signals
      });
      if (v.fillType === "image") {
        const rl = buttonResolvedVisualToRectangleLike(v);
        const fill = normalizeImageFill(rl);
        if (imageFillMissingAsset(fill) && !rl.backgroundImage?.trim()) {
          out.push({
            id: `res:button-image:${el.id}`,
            severity: "warning",
            source: "resource",
            message: translate("blueprint.diagnostics.resource.buttonImageMissing", {
              name: el.name ?? el.type
            }),
            hint: translate("blueprint.diagnostics.resource.buttonImageMissingHint"),
            elementId: el.id
          });
        }
      }
    }
  }
  /**
   * The WebGL context budget, said out loud.
   *
   * Every drawable model is one context and the browser keeps about sixteen alive per renderer
   * process - measured, see `surfacePuppetContextBudget.ts`. Past the budget the widgets that lose
   * are drawn as an explanatory box rather than blanked, but that box is only visible to whoever is
   * looking at that part of the canvas, and the whole point of the cap is that it must not be a
   * silent truncation: silence there reads as "everything is covered" when it is not.
   *
   * Counted over the whole Surface rather than over what happens to be on screen, because this is an
   * authoring-time fact about the document - scrolling changes which widgets are denied, not whether
   * the Surface asks for more than can be drawn.
   */
  if (drawablePuppets > SURFACE_PUPPET_CONTEXT_BUDGET) {
    out.push({
      id: "res:puppet-context-budget",
      severity: "warning",
      source: "resource",
      message: translate("blueprint.diagnostics.resource.puppetBudget", {
        count: drawablePuppets,
        limit: SURFACE_PUPPET_CONTEXT_BUDGET
      }),
      hint: translate("blueprint.diagnostics.resource.puppetBudgetHint", {
        limit: SURFACE_PUPPET_CONTEXT_BUDGET
      })
    });
  }
  return out;
}
