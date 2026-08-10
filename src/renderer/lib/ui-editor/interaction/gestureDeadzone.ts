/**
 * Pointer travel, in viewport pixels, that a transform gesture has to cover before it is allowed to
 * change anything. Moveable starts dragging on the first pointer move, so without a deadzone a click
 * that wobbles by one pixel writes a layout patch: selecting an element nudges it, and the nudge
 * lands on the undo stack. Four pixels is the Windows system drag threshold (`SM_CXDRAG`).
 *
 * The threshold is measured on screen rather than in surface coordinates because it exists to absorb
 * hand jitter, which does not get steadier as the canvas is zoomed out.
 */
export const GESTURE_DEADZONE_PX = 4;

export type GestureDeadzone = {
    /** Call from the gesture's start handler, with the pointer position it started from. */
    begin(clientX: number, clientY: number): void;
    /**
     * Call from the gesture's move handler. Returns whether the gesture may act. Once past the
     * threshold it stays armed until the next `begin`, so dragging back towards the origin does not
     * freeze the element mid-gesture.
     */
    update(clientX: number, clientY: number): boolean;
    /** Whether the gesture has passed the threshold; for end handlers, which get no new position. */
    readonly isArmed: boolean;
};

/**
 * Only one Moveable able runs at a time, so a single deadzone can serve drag, resize and rotate.
 */
export function createGestureDeadzone(thresholdPx: number = GESTURE_DEADZONE_PX): GestureDeadzone {
    let armed = false;
    let originX = 0;
    let originY = 0;

    return {
        begin(clientX: number, clientY: number) {
            // A gesture with no usable origin (programmatic requests carry none) arms immediately:
            // failing open costs a stray pixel, failing closed would make the element undraggable.
            armed = !Number.isFinite(clientX) || !Number.isFinite(clientY);
            originX = clientX;
            originY = clientY;
        },
        update(clientX: number, clientY: number) {
            if (armed) {
                return true;
            }
            if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
                armed = true;
                return true;
            }
            const dx = clientX - originX;
            const dy = clientY - originY;
            armed = dx * dx + dy * dy >= thresholdPx * thresholdPx;
            return armed;
        },
        get isArmed() {
            return armed;
        },
    };
}
