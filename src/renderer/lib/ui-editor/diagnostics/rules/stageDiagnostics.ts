import type { UISurface } from "@shared/types/ui-editor/document";
import { isUIStageSlotId, UI_STAGE_SLOT_IDS, UI_STAGE_SLOT_LABELS } from "@shared/types/ui-editor/stageSlots";
import { translate } from "@/lib/i18n";
import type { UISurfaceDiagnostic } from "../types";

const VALID_SLOT_LABEL_LIST = UI_STAGE_SLOT_IDS.map(slotId => UI_STAGE_SLOT_LABELS[slotId]).join(", ");

export function collectStageDiagnostics(surface: UISurface): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];
    if (surface.kind !== "stageSurface") {
        return out;
    }
    if (!isUIStageSlotId(surface.mount.slotId)) {
        out.push({
            id: `game-ui:slot-invalid:${surface.id}`,
            severity: "error",
            source: "stage",
            message: translate("blueprint.diagnostics.stage.unknownSlot"),
            hint: translate("blueprint.diagnostics.stage.unknownSlotHint", { slots: VALID_SLOT_LABEL_LIST }),
        });
    }
    return out;
}
