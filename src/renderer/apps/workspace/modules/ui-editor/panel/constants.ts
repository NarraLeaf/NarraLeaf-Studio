import type { UIStageSlotId, UIStageSurfaceMount, UISurfaceKind } from "@shared/types/ui-editor/document";

export type SurfaceKindOption = {
    kind: UISurfaceKind;
    label: string;
    description: string;
    host: "app" | "player";
};

export const SURFACE_KIND_OPTIONS: SurfaceKindOption[] = [
    {
        kind: "appSurface",
        label: "Page",
        description: "Pages are complete screens such as title, settings, save, history, or gallery.",
        host: "app",
    },
    {
        kind: "stageSurface",
        label: "Game UI",
        description: "Game UI belongs to active gameplay, such as dialog, choices, HUD, shortcuts, and notifications.",
        host: "player",
    },
];

export const GAME_UI_SLOT_OPTIONS: { value: UIStageSlotId; label: string; description: string }[] = [
    {
        value: "onStage",
        label: "On Stage",
        description: "Always available while the game is running.",
    },
    {
        value: "dialog",
        label: "Dialog",
        description: "The main conversation or narration interface.",
    },
    {
        value: "notification",
        label: "Notification",
        description: "Short runtime messages and prompts.",
    },
    {
        value: "choice",
        label: "Choice",
        description: "Player choice menus and decision prompts.",
    },
];

export const STAGE_SLOT_LABELS: Record<UIStageSlotId, string> = {
    onStage: "On Stage",
    dialog: "Dialog",
    notification: "Notification",
    choice: "Choice",
};

export const DEFAULT_STAGE_SLOT_ID: UIStageSlotId = "onStage";

export const formatStageMountLabel = (mount: UIStageSurfaceMount): string => {
    return STAGE_SLOT_LABELS[mount.slotId] ?? mount.slotId;
};
