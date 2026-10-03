import type { UIStageSlotId, UIStageSurface, UISurface } from "@shared/types/ui-editor/document";
import type {
    GameAppCompositeGameUi,
    GameAppCompositeLayer,
    GameAppCompositeOffScreenPage,
    GameAppCompositeQueuedLayer,
    GameAppCompositeSlot,
    GameAppCompositeStage,
    GameAppCompositeView,
} from "../GameAppHost";
import type { KeyboardOwnerLane } from "../keyboardOwner";
import type { SurfaceLayerEntry } from "./LayerStackController";
import type { CompositeInputResolution } from "./compositeInput";
import { isPageEntryDrawn, isStageSlotConcealedByPage } from "./stageOcclusion";

/** A Game UI surface the stage has mounted, as it registered itself. */
export type CompositeViewStageSurface = {
    runtimeScopeId: string;
    surface: UIStageSurface;
    /**
     * Whether it is one of the surfaces that take input. A display-only slot (the notification
     * toasts) takes neither a pointer nor a key, and is the only kind that answers false.
     */
    takesInput: boolean;
};

/**
 * The Game UI on the stage, read off the two lists the game app already keeps of it.
 *
 * Every surface the story puts on the stage registers itself as live while it is mounted and its
 * graphs run, so the window and preference events reach it; the ones that take input register again
 * so the keys reach them while the stage owns them (`StageSlotSurfaceBody`). The live list also
 * holds the pages drawn inside frames, which are app surfaces - a frame draws nothing else - so the
 * stage's own are the stage surfaces in it. Reading these rather than the engine's state is what
 * makes a choice list appear here only while a choice is waiting: it is listed for as long as it is
 * mounted, and for no longer.
 */
export function listStageSurfaces(input: {
    live: readonly { surface: UISurface; runtimeScopeId: string }[];
    takingInput: readonly { runtimeScopeId: string }[];
}): CompositeViewStageSurface[] {
    const takingInput = new Set(input.takingInput.map(target => target.runtimeScopeId));
    return input.live.flatMap(({ surface, runtimeScopeId }) => surface.kind === "stageSurface"
        ? [{ runtimeScopeId, surface, takesInput: takingInput.has(runtimeScopeId) }]
        : []);
}

export type CompositeViewInput = {
    /** The page stack, bottom to top. Its top is the entry the page lane is settling on. */
    pageStack: readonly { key: string; surfaceId: string }[];
    /** Whether a game has taken the screen from the page lane, and the entries it hid doing so. */
    pagesHiddenForGame: boolean;
    gameHiddenKeys: ReadonlySet<string>;
    /** The mounted stack, bottom to top. */
    layers: readonly SurfaceLayerEntry[];
    /** Layers waiting for an occupied group, in arrival order. */
    queued: readonly SurfaceLayerEntry[];
    /** The subset of {@link layers} the host actually put on screen this frame. */
    renderedLayerKeys: ReadonlySet<string>;
    /** The answer `resolveCompositeInput` already gave, passed through rather than recomputed. */
    resolution: CompositeInputResolution;
    /**
     * Where a key press goes this instant, as `resolveKeyboardOwnerLane` answers it for the key
     * listener: the entry that owns the keys and can hear them, or the stage, or nothing.
     */
    keyboardLane: KeyboardOwnerLane<{ key: string }> | null;
    /** The stage, while a game has it on screen; null otherwise. */
    stage: {
        /** Whether the story is what the player is looking at - the moment a click on it advances. */
        storyOnScreen: boolean;
        /** Whether a page is drawn over the stage, which is what the Game UI steps off for. */
        coveredByPage: boolean;
        /** Whether the stage takes pointer input at all; it does not during a quit's hand-off. */
        pointerLive: boolean;
        /** The Game UI surfaces mounted on it, in the order they registered. */
        surfaces: readonly CompositeViewStageSurface[];
    } | null;
    /** True while a removed layer is still animating out. */
    exitPending: boolean;
    /** The surface's authored name, or null when the running bundle has no surface with that id. */
    surfaceName: (surfaceId: string) => string | null;
};

/**
 * The order the player draws the Game UI slots in, bottom to top: each scene's dialogue box and then
 * its choice lists, the NVL page, the On Stage surface (the player's children), and the
 * notifications last, over everything else in it.
 */
const STAGE_SLOT_DRAW_ORDER: readonly UIStageSlotId[] = ["dialog", "choice", "nvl", "onStage", "notification"];

function describeStage(input: CompositeViewInput): GameAppCompositeStage | null {
    const { stage } = input;
    if (!stage) {
        return null;
    }
    const keyboardOwner = input.keyboardLane?.kind === "stage";
    const gameUi = stage.surfaces
        .map((entry, registered) => ({ entry, registered }))
        .sort((a, b) => (
            STAGE_SLOT_DRAW_ORDER.indexOf(a.entry.surface.mount.slotId)
                - STAGE_SLOT_DRAW_ORDER.indexOf(b.entry.surface.mount.slotId)
            || a.registered - b.registered
        ))
        .map(({ entry }): GameAppCompositeGameUi => {
            const slotId = entry.surface.mount.slotId;
            // The same expression the slot surface steps off by (`StageSlotSurfaceBody`), and the
            // same rule its element tree goes inert by: concealed, or display-only.
            const concealed = stage.coveredByPage && isStageSlotConcealedByPage(slotId);
            return {
                key: entry.runtimeScopeId,
                surfaceId: entry.surface.id,
                surfaceName: entry.surface.name,
                slotId,
                concealed,
                interactive: stage.pointerLive && entry.takesInput && !concealed,
                takesInput: entry.takesInput,
            };
        });
    return { interactive: stage.storyOnScreen, keyboardOwner, gameUi };
}

/**
 * Describe the composite stack for a reader.
 *
 * Takes the input resolution instead of deriving one. There is a single arbiter of who takes the
 * keys and who takes a click, and the whole point of a panel that reports it is to show what that
 * arbiter decided; a second derivation would agree right up until the frame someone needed it not
 * to. The keyboard is marked from the lane the key listener reads, not from the composite's owner
 * key alone: that key names the page lane's top entry even while a running game has hidden it, and a
 * hidden page hears no key - the stage does.
 *
 * What it adds is what no other reader needs: `onScreen` for a layer the render dropped for want of
 * a surface, and the pages the stack holds that are not drawn. "The stack says it is there and the
 * screen does not" is the difference this exists to make visible.
 */
export function buildCompositeView(input: CompositeViewInput): GameAppCompositeView {
    const ownsKeys = (key: string): boolean => (
        input.keyboardLane?.kind === "entry" && input.keyboardLane.entry.key === key
    );
    const isDrawn = (key: string): boolean => isPageEntryDrawn({
        entryKey: key,
        pagesHiddenForGame: input.pagesHiddenForGame,
        gameHiddenKeys: input.gameHiddenKeys,
    });

    const activePageEntry = input.pageStack[input.pageStack.length - 1] ?? null;
    const page: GameAppCompositeSlot | null = activePageEntry && isDrawn(activePageEntry.key)
        ? {
            key: activePageEntry.key,
            surfaceId: activePageEntry.surfaceId,
            surfaceName: input.surfaceName(activePageEntry.surfaceId),
            interactive: input.resolution.interactiveKeys.has(activePageEntry.key),
            keyboardOwner: ownsKeys(activePageEntry.key),
        }
        : null;

    const offScreenPages: GameAppCompositeOffScreenPage[] = input.pageStack
        .filter(entry => entry.key !== page?.key)
        .map(entry => ({
            key: entry.key,
            surfaceId: entry.surfaceId,
            surfaceName: input.surfaceName(entry.surfaceId),
            hiddenForGame: !isDrawn(entry.key),
        }));

    const layers: GameAppCompositeLayer[] = input.layers.map(layer => ({
        key: layer.key,
        surfaceId: layer.surfaceId,
        surfaceName: input.surfaceName(layer.surfaceId),
        interactive: input.resolution.interactiveKeys.has(layer.key),
        keyboardOwner: ownsKeys(layer.key),
        modal: layer.modal,
        dismissible: layer.dismissible,
        group: layer.group,
        ownerScopeId: layer.ownerScopeId,
        onScreen: input.renderedLayerKeys.has(layer.key),
    }));

    const queued: GameAppCompositeQueuedLayer[] = input.queued.map(layer => ({
        key: layer.key,
        surfaceId: layer.surfaceId,
        surfaceName: input.surfaceName(layer.surfaceId),
        modal: layer.modal,
        group: layer.group,
        ownerScopeId: layer.ownerScopeId,
    }));

    return {
        stage: describeStage(input),
        page,
        offScreenPages,
        layers,
        queued,
        exitPending: input.exitPending,
    };
}
