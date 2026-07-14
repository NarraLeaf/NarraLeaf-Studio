import type { UIStageSlotId, UIStageSurfaceMount, UISurfaceKind } from "@shared/types/ui-editor/document";
import {
    DEFAULT_UI_STAGE_SLOT_ID,
    UI_STAGE_SLOT_DESCRIPTIONS,
    UI_STAGE_SLOT_IDS,
    UI_STAGE_SLOT_LABELS,
} from "@shared/types/ui-editor/stageSlots";
import { translate } from "@/lib/i18n";

export type SurfaceKindOption = {
    kind: UISurfaceKind;
    label: string;
    description: string;
    host: "app" | "player";
};

// Labels/descriptions use getters so they resolve at render time in the active locale.
export const SURFACE_KIND_OPTIONS: SurfaceKindOption[] = [
    {
        kind: "appSurface",
        get label() {
            return translate("uiEditor.surfaceKind.page");
        },
        get description() {
            return translate("uiEditor.surfaceKind.pageDescription");
        },
        host: "app",
    },
    {
        kind: "stageSurface",
        get label() {
            return translate("uiEditor.surfaceKind.gameUi");
        },
        get description() {
            return translate("uiEditor.surfaceKind.gameUiDescription");
        },
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
