import { useLayoutEffect, type RefObject, type SyntheticEvent } from "react";
import { UI_TOUCH_GESTURE_EVENT } from "@/lib/ui-editor/runtime/input/touchGesture";

/**
 * Ending a press at the element it landed on, so nothing further up the tree hears it.
 *
 * For the boxes that exist to keep a press from being misread while something is changing: a frame
 * changing page (`FramePageBox`) and a game app's pages while one of them plays its exit
 * (`SurfaceStackBox`). What lies further up is not harmless. The frame's own click walks up the
 * element tree into the surface's actions, and the game's drawing root offers every press that
 * reaches it to the global blueprint - so a press either box lets through can still turn into a line
 * the player never read, or a menu they never asked for.
 *
 * The list is every pointer input the surface lanes and the game root answer: the three click kinds,
 * the context menu, the wheel and the pointer that starts and ends a press. A recognised touch gesture
 * travels under a private event name React has no prop for, so it is stopped by a native listener -
 * see {@link useSwallowTouchGestures}.
 */

function stopHere(event: SyntheticEvent): void {
    event.stopPropagation();
}

function stopContextMenuHere(event: SyntheticEvent): void {
    // Nothing further up answers it, so nothing further up gets to prevent the browser's own menu.
    event.preventDefault();
    event.stopPropagation();
}

function stopNativeHere(event: Event): void {
    event.stopPropagation();
}

/** Spread onto the element that ends a press. */
export const SWALLOW_PRESS_HANDLERS = {
    onClick: stopHere,
    onDoubleClick: stopHere,
    onAuxClick: stopHere,
    onContextMenu: stopContextMenuHere,
    onWheel: stopHere,
    onPointerDown: stopHere,
    onPointerUp: stopHere,
} as const;

/**
 * Stop the touch recogniser's gesture at `ref` while `active`.
 *
 * A layout effect, so the listener is attached in the same commit that puts the element up and no
 * gesture arrives in between.
 */
export function useSwallowTouchGestures(ref: RefObject<HTMLElement | null>, active: boolean): void {
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element || !active) {
            return undefined;
        }
        element.addEventListener(UI_TOUCH_GESTURE_EVENT, stopNativeHere);
        return () => element.removeEventListener(UI_TOUCH_GESTURE_EVENT, stopNativeHere);
    }, [active, ref]);
}
