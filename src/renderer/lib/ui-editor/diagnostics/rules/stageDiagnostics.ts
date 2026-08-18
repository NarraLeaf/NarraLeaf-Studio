import type { UISurface } from "@shared/types/ui-editor/document";
import { isUIStageSlotId, UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import { translate } from "@/lib/i18n";
import { getStageSlotLabel } from "@/lib/ui-editor/stageSlotLabel";
import type { UISurfaceDiagnostic } from "../types";

export function collectStageDiagnostics(surface: UISurface): UISurfaceDiagnostic[] {
  const out: UISurfaceDiagnostic[] = [];
  if (surface.kind !== "stageSurface") {
    return out;
  }
  if (!isUIStageSlotId(surface.mount.slotId)) {
    // Built per call, not once at module load: the list is read in whatever locale the author is
    // in when the diagnostic surfaces.
    const validSlotList = UI_STAGE_SLOT_IDS.map((slotId) =>
      getStageSlotLabel(slotId, translate)
    ).join(", ");
    out.push({
      id: `game-ui:slot-invalid:${surface.id}`,
      severity: "error",
      source: "stage",
      message: translate("blueprint.diagnostics.stage.unknownSlot"),
      hint: translate("blueprint.diagnostics.stage.unknownSlotHint", { slots: validSlotList })
    });
  }
  return out;
}
