import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type PointerEvent,
} from "react";
import type { UIElement } from "@shared/types/ui-editor/document";
import {
    getUISwitchChildSlot,
    UI_SWITCH_ON_VARIANT_ID,
    type UISwitchChildSlot,
} from "@shared/types/ui-editor/switch";
import {
    getStateMotions,
    resolveStateMotionOffset,
    type UIStateMotion,
} from "@shared/types/ui-editor/stateMotion";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import {
    useWidgetRuntimeElementKey,
    useWidgetRuntimeSnapshot,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { useEnteredElementState } from "@/lib/ui-editor/hooks/useEnteredElementState";
import { getSwitchProps } from "./helpers";

/**
 * Pointer travel, in px, below which a press is still a click rather than a drag.
 *
 * A hand always slides a pixel or two while pressing, and a switch is a small target: without a
 * slop every click would be classified as a drag, and a drag that ends where it started commits
 * nothing, so plain clicking would silently stop working. Four pixels is the same order as the
 * slop the platform itself uses to tell a tap from a drag.
 */
const SWITCH_DRAG_CLICK_SLOP_PX = 4;

/** Ratio along the track past which releasing commits the on state. */
const SWITCH_DRAG_COMMIT_RATIO = 0.5;

function findSwitchPart(
    element: UIElement,
    document: WidgetRendererProps["document"],
    wanted: UISwitchChildSlot,
): UIElement | null {
    const props = getSwitchProps(element);
    const propId = wanted === "track" ? props.trackElementId : props.thumbElementId;
    const byProp = propId ? document.elements[propId] : undefined;
    if (byProp && byProp.parentId === element.id) {
        return byProp;
    }
    return element.childrenIds
        .map(id => document.elements[id])
        .find(child => getUISwitchChildSlot(child?.extra) === wanted) ?? null;
}

function findRenderedUiElement(root: Element | null, id: string): HTMLElement | null {
    if (!root) {
        return null;
    }
    for (const node of root.querySelectorAll<HTMLElement>("[data-ui-element-id]")) {
        if (node.getAttribute("data-ui-element-id") === id) {
            return node;
        }
    }
    return null;
}

/**
 * Where the pointer sits along a rect: 0 at its left edge, 1 at its right.
 *
 * This is the only measurement the switch ever takes, and it measures the *pointer* against the
 * track it was pressed on - never a part's position. The thumb's travel stays the `on` variant's
 * `transformOffsetX`, owned by the appearance system, exactly as it was before dragging existed.
 */
function rectRatioX(rect: DOMRect, clientX: number): number {
    return (clientX - rect.left) / Math.max(1, rect.width);
}

/**
 * Hands a part what the switch says about the state it is in: which variant to look like, and how far
 * to move. Geometry is deliberately left untouched - where the part sits is the part's own business,
 * and the offset is a layer the switch adds while it is on.
 */
function withSwitchState(
    element: UIElement,
    checked: boolean,
    motions: UIStateMotion[],
): UIElement {
    const stateMotionOffset = resolveStateMotionOffset(
        motions,
        checked ? UI_SWITCH_ON_VARIANT_ID : null,
        element.id,
    );
    return {
        ...element,
        extra: {
            ...(element.extra ?? {}),
            ...(checked ? { runtimeVariantOverrideId: UI_SWITCH_ON_VARIANT_ID } : {}),
            ...(stateMotionOffset ? { stateMotionOffset } : {}),
        },
    };
}

/**
 * The switch owns no geometry at all: on/off is an appearance variant on each part (the track's
 * colour, the thumb's `transformOffsetX`), so this renderer only decides *which variant* the two
 * parts resolve with and dispatches the blueprint events. Compare `slider/renderer.tsx`, which has
 * to compute the handle's position on every render.
 *
 * Dragging keeps that property. A press does not toggle; the pointer's normalized position on the
 * track decides what a release commits, and the mid-drag preview is the same variant override the
 * committed state uses - so the thumb snaps across under the author's own transition instead of
 * being dragged by an inline transform this renderer would have to compute.
 */
export function SwitchRenderer(props: WidgetRendererProps) {
    const { element, document, hostAdapter, renderChildren, useAppearanceInspectorPreview } = props;
    // In the editor the author's entered state is what the switch shows, so flipping the state bar
    // previews the toggle - including its motion - without touching the authored `checked`.
    const enteredState = useEnteredElementState(element.id, useAppearanceInspectorPreview === true);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const flushFrameRef = useRef<number | null>(null);
    // A toggle whose graph is still running swallows further toggles rather than queueing them:
    // unlike the slider there is no stream of values to coalesce, and running the same graph
    // concurrently from a double click is the failure this guards.
    const toggleInFlightRef = useRef(false);
    /** Tears down the live drag's window listeners; set only while a gesture is in flight. */
    const dragDisposeRef = useRef<(() => void) | null>(null);
    /** What a release would commit right now, or null when no drag is in flight. */
    const [pendingChecked, setPendingChecked] = useState<boolean | null>(null);
    const runtimeStore = useWidgetRuntimeStateStore();
    const runtimeElementKey = useWidgetRuntimeElementKey(element.id);
    const snapshot = useWidgetRuntimeSnapshot();
    const authoredProps = getSwitchProps(element);
    const runtimeProps = runtimeStore?.getSwitchProperties(runtimeElementKey);
    const switchProps = getSwitchProps({
        ...element,
        props: {
            ...authoredProps,
            ...(runtimeProps ?? {}),
        },
    });
    void snapshot;

    const checked = switchProps.checked;
    const checkedRef = useRef(checked);
    useEffect(() => {
        checkedRef.current = checked;
    }, [checked]);
    // What the parts are drawn as. Mid-drag this previews the release rather than the committed
    // state, which is why nothing writes to the runtime store until the pointer comes up.
    const displayChecked = enteredState
        ? enteredState.variantId === UI_SWITCH_ON_VARIANT_ID
        : pendingChecked ?? checked;

    const trackElement = useMemo(() => findSwitchPart(element, document, "track"), [document, element]);
    const thumbElement = useMemo(() => findSwitchPart(element, document, "thumb"), [document, element]);

    const blueprintRuntime = hostAdapter.blueprintRuntime;
    const canRunSwitchInteraction =
        Boolean(blueprintRuntime && runtimeStore) && !switchProps.interactionDisabled;

    useEffect(() => () => {
        if (flushFrameRef.current !== null) {
            window.cancelAnimationFrame(flushFrameRef.current);
            flushFrameRef.current = null;
        }
        dragDisposeRef.current?.();
    }, []);

    const scheduleSwitchFlush = useCallback(() => {
        if (!blueprintRuntime) {
            return;
        }
        if (flushFrameRef.current !== null) {
            return;
        }
        flushFrameRef.current = window.requestAnimationFrame(() => {
            flushFrameRef.current = null;
            void blueprintRuntime.dispatchElementBlueprintEvent(element.id, "flush", {
                element: {
                    surfaceId: blueprintRuntime.surfaceId,
                    elementId: element.id,
                    elementType: element.type,
                },
            });
        });
    }, [blueprintRuntime, element.id, element.type]);

    const applyChecked = useCallback(
        (nextChecked: boolean) => {
            if (!canRunSwitchInteraction || !runtimeStore || !blueprintRuntime) {
                return;
            }
            if (toggleInFlightRef.current) {
                return;
            }
            const previousChecked = checkedRef.current;
            if (nextChecked === previousChecked) {
                return;
            }
            const next = runtimeStore.setSwitchProperties(runtimeElementKey, authoredProps, {
                checked: nextChecked,
            }).checked;
            if (next === previousChecked) {
                return;
            }
            checkedRef.current = next;
            toggleInFlightRef.current = true;
            void (async () => {
                try {
                    await blueprintRuntime.dispatchElementBlueprintEvent(element.id, "changed", {
                        checked: next,
                        previousChecked,
                    });
                    await blueprintRuntime.dispatchElementBlueprintEvent(
                        element.id,
                        next ? "turnedOn" : "turnedOff",
                        { checked: next },
                    );
                } finally {
                    toggleInFlightRef.current = false;
                    scheduleSwitchFlush();
                }
            })();
        },
        [
            authoredProps,
            blueprintRuntime,
            canRunSwitchInteraction,
            element.id,
            runtimeElementKey,
            runtimeStore,
            scheduleSwitchFlush,
        ],
    );

    const toggle = useCallback(() => {
        applyChecked(!checkedRef.current);
    }, [applyChecked]);

    const trackRatioFromPointer = useCallback(
        (clientX: number): number | null => {
            const root = rootRef.current;
            const trackNode = trackElement ? findRenderedUiElement(root, trackElement.id) : null;
            const rect = trackNode?.getBoundingClientRect() ?? root?.getBoundingClientRect();
            return rect ? rectRatioX(rect, clientX) : null;
        },
        [trackElement],
    );

    const handlePointerDown = useCallback(
        (event: PointerEvent<HTMLDivElement>) => {
            if (!canRunSwitchInteraction || event.button !== 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();

            const startX = event.clientX;
            const startY = event.clientY;
            let dragged = false;
            let releaseChecked: boolean | null = null;
            let disposed = false;

            const endDrag = () => {
                if (disposed) {
                    return;
                }
                disposed = true;
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                window.removeEventListener("pointercancel", onCancel);
                if (dragDisposeRef.current === endDrag) {
                    dragDisposeRef.current = null;
                }
            };
            const onMove = (moveEvent: globalThis.PointerEvent) => {
                if (disposed) {
                    return;
                }
                if (
                    !dragged &&
                    Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) <
                        SWITCH_DRAG_CLICK_SLOP_PX
                ) {
                    return;
                }
                dragged = true;
                moveEvent.preventDefault();
                const ratio = trackRatioFromPointer(moveEvent.clientX);
                if (ratio === null) {
                    return;
                }
                releaseChecked = ratio >= SWITCH_DRAG_COMMIT_RATIO;
                setPendingChecked(releaseChecked);
            };
            const onUp = () => {
                if (disposed) {
                    return;
                }
                endDrag();
                setPendingChecked(null);
                if (!dragged) {
                    // Never left the slop: this was a click, and a click toggles.
                    toggle();
                    return;
                }
                if (releaseChecked !== null) {
                    applyChecked(releaseChecked);
                }
            };
            // A cancelled gesture (the OS took the pointer, the window lost it) is not a release:
            // it must leave the switch exactly as it found it.
            const onCancel = () => {
                if (disposed) {
                    return;
                }
                endDrag();
                setPendingChecked(null);
            };

            dragDisposeRef.current?.();
            dragDisposeRef.current = endDrag;
            window.addEventListener("pointermove", onMove, { passive: false });
            window.addEventListener("pointerup", onUp, { once: true });
            window.addEventListener("pointercancel", onCancel, { once: true });
        },
        [applyChecked, canRunSwitchInteraction, toggle, trackRatioFromPointer],
    );

    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLDivElement>) => {
            if (!canRunSwitchInteraction) {
                return;
            }
            if (event.key !== " " && event.key !== "Enter") {
                return;
            }
            event.preventDefault();
            toggle();
        },
        [canRunSwitchInteraction, toggle],
    );

    const canRenderParts = Boolean(renderChildren);
    const childrenIds = [trackElement?.id, thumbElement?.id].filter((id): id is string => Boolean(id));
    const stateMotions = getStateMotions(element.props);
    // Built for both states, not just on: turning off is a move back, and the part only knows to make
    // it because the switch hands it the same motion with a zero offset.
    const elementOverrides = Object.fromEntries(
        [trackElement, thumbElement]
            .filter((part): part is UIElement => Boolean(part))
            .map(part => [part.id, withSwitchState(part, displayChecked, stateMotions)]),
    );

    const hostStyle: CSSProperties = {
        position: "relative",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        overflow: "visible",
    };

    // Fallback chrome for a project whose author deleted a part: a missing part must read as a
    // plain switch, never as a blank box.
    const fallbackTrackStyle: CSSProperties = {
        position: "absolute",
        inset: 0,
        borderRadius: 999,
        background: displayChecked ? "rgba(59, 130, 246, 0.9)" : "rgba(100, 116, 139, 0.75)",
    };
    const fallbackThumbStyle: CSSProperties = {
        position: "absolute",
        top: 3,
        bottom: 3,
        left: displayChecked ? "auto" : 3,
        right: displayChecked ? 3 : "auto",
        aspectRatio: "1 / 1",
        borderRadius: 999,
        background: "#f8fafc",
        border: "1px solid rgba(15, 23, 42, 0.2)",
    };

    return (
        <div
            ref={rootRef}
            style={hostStyle}
            role="switch"
            aria-checked={checked}
            aria-disabled={canRunSwitchInteraction ? undefined : true}
            data-ui-switch-checked={checked ? "true" : "false"}
            // Present only while a drag is in flight; says what releasing now would commit.
            data-ui-switch-pending={pendingChecked === null ? undefined : pendingChecked ? "true" : "false"}
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
        >
            {canRenderParts && trackElement ? null : (
                <div data-ui-switch-part="track" style={fallbackTrackStyle} />
            )}
            {canRenderParts && childrenIds.length > 0 && renderChildren
                ? renderChildren({
                      childrenIds,
                      instanceKey: `switch-${element.id}`,
                      elementOverrides,
                  })
                : null}
            {canRenderParts && thumbElement ? null : (
                <div data-ui-switch-part="thumb" style={fallbackThumbStyle} />
            )}
        </div>
    );
}
