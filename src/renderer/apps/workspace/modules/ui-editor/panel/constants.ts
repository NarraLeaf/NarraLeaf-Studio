import type { UIStageSlotId, UIStageSurfaceMount, UISurfaceKind, UISurfaceOwnerKind } from "@shared/types/ui-editor/document";
import { DEFAULT_UI_STAGE_SLOT_ID, UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import { translate } from "@/lib/i18n";
import { getStageSlotLabel, type TranslateFn } from "@/lib/ui-editor/stageSlotLabel";
import { stageMountSlotId } from "@shared/types/ui-editor/stageSlots";

/**
 * Which list the author is looking at.
 *
 * A view is not a {@link UISurfaceKind}: two of them are the same kind (`stageSurface`) and differ by
 * where the surface mounts. Keeping them apart here rather than inventing a third stored kind is what
 * lets an avatar frame be an ordinary Game UI surface everywhere else in the codebase.
 */
export type SurfacePanelView = "appSurface" | "stageSurface" | "stageAvatar";

export type SurfaceKindOption = {
    kind: UISurfaceKind;
    /** Defaults to {@link SurfaceKindOption.kind} for the two views that are one kind each. */
    view?: SurfacePanelView;
    label: string;
    description: string;
    host: "app" | "player";
};

/** The view an option answers to. */
export function surfaceKindOptionView(option: SurfaceKindOption): SurfacePanelView {
    return option.view ?? (option.kind as SurfacePanelView);
}

/**
 * The surfaces a *feature* owns, rather than ones the author files under a type.
 *
 * These are deliberately not peers of Page and Game UI in the filter row. Page and Game UI are what
 * an interface *is*; an avatar frame is a Game UI surface that a particular feature makes and reads,
 * and a mouse cursor will be another. Ranked beside the two, each new one would shave a little more
 * width off a row that answers a different question — so they live behind one button that opens onto
 * them, and the row stays two entries wide however many features grow surfaces of their own.
 */
export type SurfaceOwnerOption = {
    view: SurfacePanelView;
    owner: UISurfaceOwnerKind;
    kind: UISurfaceKind;
    host: "app" | "player";
    label: string;
    description: string;
};

export const SURFACE_OWNER_OPTIONS: SurfaceOwnerOption[] = [
    {
        view: "stageAvatar",
        owner: "stageAvatar",
        kind: "stageSurface",
        host: "player",
        get label() {
            return translate("uiEditor.surfaceOwner.stageAvatar");
        },
        get description() {
            return translate("uiEditor.surfaceOwnerDescription.stageAvatar");
        },
    },
];

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
    const slotId = stageMountSlotId(mount);
    return slotId ? getStageSlotLabel(slotId, t) : t("uiEditor.surfaceOwner.stageAvatar");
};
