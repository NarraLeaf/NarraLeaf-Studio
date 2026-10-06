import type {
    UIDocument,
    UIStageSlotId,
    UISurface,
    UISurfaceDesignSize,
    UISurfaceId,
} from "@shared/types/ui-editor/document";
import { isUIStageSlotId, UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import { selectStageSurfaceForSlot } from "@/lib/ui-editor/runtime/app/stageSlots";

/**
 * The Game UI slots in the order a running game stacks them, bottom first.
 *
 * Read off the engine's `Player`, which draws every slot inside one stage and gives none of them a
 * z-index, so document order is paint order there: the scene's dialogue box and then its choice
 * menus (both in `SceneDialogs`), the NVL page, the Player's children - which is where Studio mounts
 * the On Stage surface (`NlrStageLayer`) - and the notification layer last. A canvas that stacks the
 * other Game UI around the surface being edited has to use this order, or the reference would show a
 * quick menu under a dialogue box that covers it in the game.
 */
export const GAME_UI_SLOT_STACK_ORDER: readonly UIStageSlotId[] = ["dialog", "choice", "nvl", "onStage", "notification"];

/** One other Game UI surface the canvas can show beside the surface being edited. */
export type GameUiReferenceCandidate = {
    slotId: UIStageSlotId;
    surfaceId: UISurfaceId;
    name: string;
    designSize: UISurfaceDesignSize;
};

export type GameUiReferenceLayer = GameUiReferenceCandidate & {
    /**
     * The referenced surface is not the size of the one being edited. Both are drawn from the
     * stage's top-left at one design pixel each, exactly as the game draws them, so their contents
     * still sit where the game puts them; what no longer agrees is the two frames, and with them
     * anything either surface anchors to its own edges.
     */
    sizeDiffers: boolean;
};

export type GameUiReferencePlan = {
    /** Drawn before the edited surface, bottom first. */
    below: GameUiReferenceLayer[];
    /** Drawn after it, bottom first. */
    above: GameUiReferenceLayer[];
};

const EMPTY_PLAN: GameUiReferencePlan = { below: [], above: [] };

function stackIndex(slotId: UIStageSlotId): number {
    return GAME_UI_SLOT_STACK_ORDER.indexOf(slotId);
}

/**
 * The other Game UI a game would draw alongside `edited`, one per slot, in the order slots are
 * listed everywhere else in the editor.
 *
 * Each slot answers with the surface the game itself picks for it (`selectStageSurfaceForSlot`), so
 * the reference is the surface the player would see rather than whichever one the author opened
 * last. The edited surface's own slot is never offered: the game draws one surface there, and when
 * it is not the edited one, showing it would put a second dialogue box where the game draws one.
 * A page, which the game does not compose with the stage slots, has no candidates.
 */
export function listGameUiReferenceCandidates(document: UIDocument, edited: UISurface): GameUiReferenceCandidate[] {
    if (edited.kind !== "stageSurface") {
        return [];
    }
    const candidates: GameUiReferenceCandidate[] = [];
    for (const slotId of UI_STAGE_SLOT_IDS) {
        if (slotId === edited.mount.slotId) {
            continue;
        }
        const surface = selectStageSurfaceForSlot(document, slotId);
        if (!surface || surface.id === edited.id) {
            continue;
        }
        candidates.push({ slotId, surfaceId: surface.id, name: surface.name, designSize: surface.designSize });
    }
    return candidates;
}

/**
 * Which references to draw for `edited`, split around it by the game's stacking order.
 *
 * A slot that is switched on but has no surface in this project is skipped rather than reported:
 * the menu lists only the slots that have one, so the switch outlives a surface being deleted and
 * comes back on its own when one is created.
 */
export function planGameUiReferenceLayers(
    document: UIDocument,
    edited: UISurface,
    enabledSlotIds: readonly UIStageSlotId[],
): GameUiReferencePlan {
    if (edited.kind !== "stageSurface" || enabledSlotIds.length === 0) {
        return EMPTY_PLAN;
    }
    const editedIndex = stackIndex(edited.mount.slotId);
    const layers = listGameUiReferenceCandidates(document, edited)
        .filter(candidate => enabledSlotIds.includes(candidate.slotId))
        .map<GameUiReferenceLayer>(candidate => ({
            ...candidate,
            sizeDiffers:
                candidate.designSize.width !== edited.designSize.width
                || candidate.designSize.height !== edited.designSize.height,
        }))
        .sort((a, b) => stackIndex(a.slotId) - stackIndex(b.slotId));
    return {
        below: layers.filter(layer => stackIndex(layer.slotId) < editedIndex),
        above: layers.filter(layer => stackIndex(layer.slotId) > editedIndex),
    };
}

/**
 * A stored list of switched-on slots, made safe to use: unknown ids and repeats dropped, the rest in
 * the editor's slot order. Anything that is not a list reads as "none", so a damaged setting turns
 * every reference off rather than drawing something nobody chose.
 */
export function normalizeGameUiReferenceSlotIds(value: unknown): UIStageSlotId[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return UI_STAGE_SLOT_IDS.filter(slotId => value.some(entry => isUIStageSlotId(entry) && entry === slotId));
}

/** `current` with `slotId` switched on or off, in the same normal form. */
export function withGameUiReferenceSlot(
    current: readonly UIStageSlotId[],
    slotId: UIStageSlotId,
    enabled: boolean,
): UIStageSlotId[] {
    const next = current.filter(entry => entry !== slotId);
    if (enabled) {
        next.push(slotId);
    }
    return normalizeGameUiReferenceSlotIds(next);
}
