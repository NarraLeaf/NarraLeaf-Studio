import type { UIStageSlotId, UIStageSurfaceMount, UISurfaceKind } from "@shared/types/ui-editor/document";
import { DEFAULT_UI_STAGE_SLOT_ID, UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import { translate } from "@/lib/i18n";
import { getStageSlotLabel, type TranslateFn } from "@/lib/ui-editor/stageSlotLabel";

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

/** Slot ids in stage order. Their author-facing names come from `getStageSlotOptions`. */
export const GAME_UI_SLOT_IDS: readonly UIStageSlotId[] = UI_STAGE_SLOT_IDS;

export const DEFAULT_STAGE_SLOT_ID: UIStageSlotId = DEFAULT_UI_STAGE_SLOT_ID;

export const formatStageMountLabel = (mount: UIStageSurfaceMount, t: TranslateFn): string => {
    return getStageSlotLabel(mount.slotId, t);
};
