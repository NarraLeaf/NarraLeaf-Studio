import type { UIStageSlotId, UIStageSurfaceMount, UISurfaceKind } from "@shared/types/ui-editor/document";
import {
    DEFAULT_UI_STAGE_SLOT_ID,
    UI_STAGE_SLOT_DESCRIPTIONS,
    UI_STAGE_SLOT_IDS,
    UI_STAGE_SLOT_LABELS,
} from "@shared/types/ui-editor/stageSlots";

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

export const GAME_UI_SLOT_OPTIONS: { value: UIStageSlotId; label: string; description: string }[] =
    UI_STAGE_SLOT_IDS.map(value => ({
        value,
        label: UI_STAGE_SLOT_LABELS[value],
        description: UI_STAGE_SLOT_DESCRIPTIONS[value],
    }));

export const STAGE_SLOT_LABELS: Record<UIStageSlotId, string> = UI_STAGE_SLOT_LABELS;

export const DEFAULT_STAGE_SLOT_ID: UIStageSlotId = DEFAULT_UI_STAGE_SLOT_ID;

export const formatStageMountLabel = (mount: UIStageSurfaceMount): string => {
    return STAGE_SLOT_LABELS[mount.slotId] ?? mount.slotId;
};
