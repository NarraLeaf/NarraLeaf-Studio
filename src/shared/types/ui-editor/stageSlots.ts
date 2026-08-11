import type { UIStageSlotId } from "./document";

export const UI_STAGE_SLOT_IDS = ["onStage", "dialog", "notification", "choice", "nvl"] as const satisfies readonly UIStageSlotId[];

export const DEFAULT_UI_STAGE_SLOT_ID: UIStageSlotId = "onStage";

// What a slot is called, and what it is for, lives in the `uiEditor.stageSlot*` catalogue families -
// read them through `@/lib/ui-editor/stageSlotLabel`. This module holds identity only, so a slot
// name cannot be shown to an author without passing through the active locale.

export function isUIStageSlotId(value: unknown): value is UIStageSlotId {
    return typeof value === "string" && (UI_STAGE_SLOT_IDS as readonly string[]).includes(value);
}

export function normalizeUIStageSlotId(value: unknown): UIStageSlotId {
    if (value === "menu") {
        return "choice";
    }
    return isUIStageSlotId(value) ? value : DEFAULT_UI_STAGE_SLOT_ID;
}
