import type { UIStageSlotId } from "./document";

export const UI_STAGE_SLOT_IDS = ["onStage", "dialog", "notification", "choice", "nvl"] as const satisfies readonly UIStageSlotId[];

export const DEFAULT_UI_STAGE_SLOT_ID: UIStageSlotId = "onStage";

export const UI_STAGE_SLOT_LABELS: Record<UIStageSlotId, string> = {
    onStage: "On Stage",
    dialog: "Dialog",
    notification: "Notification",
    choice: "Choice",
    nvl: "NVL",
};

export const UI_STAGE_SLOT_DESCRIPTIONS: Record<UIStageSlotId, string> = {
    onStage: "Always available while the game is running.",
    dialog: "The main conversation or narration interface.",
    notification: "Short runtime messages and prompts.",
    choice: "Player choice menus and decision prompts.",
    nvl: "Full-screen novel-mode dialog history.",
};

export function isUIStageSlotId(value: unknown): value is UIStageSlotId {
    return typeof value === "string" && (UI_STAGE_SLOT_IDS as readonly string[]).includes(value);
}

export function normalizeUIStageSlotId(value: unknown): UIStageSlotId {
    if (value === "menu") {
        return "choice";
    }
    return isUIStageSlotId(value) ? value : DEFAULT_UI_STAGE_SLOT_ID;
}
