import type { UIStageSlotId, UIStageSurfaceMount, UISurfaceKind } from "@shared/types/ui-editor/document";
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
    {
        // Not a `UISurfaceKind` of its own: an avatar frame is a Game UI surface, and what sets it
        // apart is where it mounts. It gets its own tab because it is a different *kind of thing to
        // the author* — the five slots are singletons the game fills, while these are made on demand
        // by a feature, named, and referred to from a story row. One list, grouped by the feature
        // that owns them, is what keeps them from becoming scattered per-feature registries.
        kind: "stageSurface",
        view: "stageAvatar",
        get label() {
            return translate("uiEditor.surfaceOwner.stageAvatar");
        },
        get description() {
            return translate("uiEditor.surfaceOwnerDescription.stageAvatar");
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
