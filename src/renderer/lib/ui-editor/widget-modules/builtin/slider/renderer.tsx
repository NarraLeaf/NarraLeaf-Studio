import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type PointerEvent } from "react";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import {
    getUISliderChildSlot,
    normalizedSliderValueToMapped,
    sliderValueToNormalized,
    type UISliderOrientation,
} from "@shared/types/ui-editor/slider";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import {
    useWidgetRuntimeElementKey,
    useWidgetRuntimeSnapshot,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { getSliderProps } from "./helpers";

function axisSize(layout: UILayout, orientation: UISliderOrientation): number {
    return Math.max(1, Math.abs(orientation === "horizontal" ? layout.width : layout.height));
}

function layoutWithSliderValue(
    track: UIElement,
    handle: UIElement,
    orientation: UISliderOrientation,
    normalizedValue: number,
): UILayout {
    const trackSize = axisSize(track.layout, orientation);
    const handleSize = axisSize(handle.layout, orientation);
    if (orientation === "horizontal") {
        return {
            ...handle.layout,
            x: track.layout.x + trackSize * normalizedValue - handleSize / 2,
        };
    }
    return {
        ...handle.layout,
        y: track.layout.y + trackSize * (1 - normalizedValue) - handleSize / 2,
    };
}

function eventTargetElement(target: EventTarget | null): Element | null {
    if (target instanceof Element) {
        return target;
    }
    if (target instanceof Node) {
        return target.parentElement;
    }
    return null;
}

function closestUiElementIdInSet(target: EventTarget | null, ids: Set<string>): string | null {
    let element = eventTargetElement(target);
    while (element) {
        const id = element.getAttribute("data-ui-element-id");
        if (id && ids.has(id)) {
            return id;
        }
        element = element.parentElement;
    }
    return null;
}

function findRenderedUiElement(root: Element | null, id: string): HTMLElement | null {
    if (!root) {
        return null;
    }
    for (const element of root.querySelectorAll<HTMLElement>("[data-ui-element-id]")) {
        if (element.getAttribute("data-ui-element-id") === id) {
            return element;
        }
    }
    return null;
}

function pointerAxisPosition(clientX: number, clientY: number, orientation: UISliderOrientation): number {
    return orientation === "horizontal" ? clientX : clientY;
}

function rectAxisStart(rect: DOMRect, orientation: UISliderOrientation): number {
    return orientation === "horizontal" ? rect.left : rect.top;
}

function rectAxisSize(rect: DOMRect, orientation: UISliderOrientation): number {
    return Math.max(1, orientation === "horizontal" ? rect.width : rect.height);
}

function findSliderPart(element: UIElement, document: WidgetRendererProps["document"], wanted: "track" | "handle"): UIElement | null {
    const props = getSliderProps(element);
    const propId = wanted === "track" ? props.trackElementId : props.handleElementId;
    const byProp = propId ? document.elements[propId] : undefined;
    if (byProp && byProp.parentId === element.id) {
        return byProp;
    }
    return element.childrenIds
        .map(id => document.elements[id])
        .find(child => getUISliderChildSlot(child?.extra) === wanted) ?? null;
}

export function SliderRenderer(props: WidgetRendererProps) {
    const { element, document, hostAdapter, renderChildren } = props;
    const rootRef = useRef<HTMLDivElement | null>(null);
    const runtimeStore = useWidgetRuntimeStateStore();
    const runtimeElementKey = useWidgetRuntimeElementKey(element.id);
    const snapshot = useWidgetRuntimeSnapshot();
    const authoredProps = getSliderProps(element);
    const runtimeProps = runtimeStore?.getSliderProperties(runtimeElementKey);
    const sliderProps = getSliderProps({
        ...element,
        props: {
            ...authoredProps,
            ...(runtimeProps ?? {}),
        },
    });
    const valueRef = useRef(sliderProps.value);
    useEffect(() => {
        valueRef.current = sliderProps.value;
    }, [sliderProps.value]);
    void snapshot;

    const trackElement = useMemo(() => findSliderPart(element, document, "track"), [document, element]);
    const handleElement = useMemo(() => findSliderPart(element, document, "handle"), [document, element]);
    const partIds = useMemo(
        () => new Set([trackElement?.id, handleElement?.id].filter((id): id is string => Boolean(id))),
        [handleElement?.id, trackElement?.id],
    );
    const normalizedValue = sliderValueToNormalized(sliderProps.value, sliderProps);
    const blueprintRuntime = hostAdapter.blueprintRuntime;
    const hostApi = blueprintRuntime?.hostApi;

    const valueFromPointer = useCallback(
        (clientX: number, clientY: number, pointerOffsetFromHandleCenter = 0): number => {
            const root = rootRef.current;
            const trackNode = trackElement ? findRenderedUiElement(root, trackElement.id) : null;
            const rect = trackNode?.getBoundingClientRect() ?? root?.getBoundingClientRect();
            if (!rect) {
                return valueRef.current;
            }
            const targetCenter =
                pointerAxisPosition(clientX, clientY, sliderProps.orientation) -
                pointerOffsetFromHandleCenter;
            const ratioOnTrack =
                (targetCenter - rectAxisStart(rect, sliderProps.orientation)) /
                rectAxisSize(rect, sliderProps.orientation);
            const ratio =
                sliderProps.orientation === "horizontal"
                    ? ratioOnTrack
                    : 1 - ratioOnTrack;
            return normalizedSliderValueToMapped(ratio, sliderProps);
        },
        [sliderProps, trackElement],
    );

    const pointerOffsetFromHandleCenter = useCallback(
        (clientX: number, clientY: number): number => {
            const root = rootRef.current;
            const handleNode = handleElement ? findRenderedUiElement(root, handleElement.id) : null;
            const rect = handleNode?.getBoundingClientRect();
            if (!rect) {
                return 0;
            }
            const center =
                rectAxisStart(rect, sliderProps.orientation) +
                rectAxisSize(rect, sliderProps.orientation) / 2;
            return pointerAxisPosition(clientX, clientY, sliderProps.orientation) - center;
        },
        [handleElement, sliderProps.orientation],
    );

    const setRuntimeValue = useCallback(
        async (nextValue: number, dispatchChange: boolean) => {
            if (!hostApi) {
                return valueRef.current;
            }
            const previousValue = valueRef.current;
            await hostApi.widget.setSliderProperties(element.id, { value: nextValue });
            const current = hostApi.widget.getSliderProperties(element.id).value;
            valueRef.current = current;
            if (dispatchChange && current !== previousValue) {
                await blueprintRuntime?.dispatchElementBlueprintEvent(element.id, "valueChanged", {
                    value: current,
                    previousValue,
                });
            }
            return current;
        },
        [blueprintRuntime, element.id, hostApi],
    );

    const handlePointerDown = useCallback(
        (event: PointerEvent<HTMLDivElement>) => {
            if (!hostApi || !blueprintRuntime || event.button !== 0) {
                return;
            }
            const hitPartId = partIds.size > 0 ? closestUiElementIdInSet(event.target, partIds) : null;
            if (partIds.size > 0 && !hitPartId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();

            const dragPointerOffset =
                hitPartId === handleElement?.id
                    ? pointerOffsetFromHandleCenter(event.clientX, event.clientY)
                    : 0;
            let disposed = false;
            void (async () => {
                const previousValue = valueRef.current;
                const firstValue = await setRuntimeValue(
                    valueFromPointer(event.clientX, event.clientY, dragPointerOffset),
                    false,
                );
                await blueprintRuntime.dispatchElementBlueprintEvent(element.id, "dragStart", { value: firstValue });
                if (firstValue !== previousValue) {
                    await blueprintRuntime.dispatchElementBlueprintEvent(element.id, "valueChanged", {
                        value: firstValue,
                        previousValue,
                    });
                }
            })();

            const onMove = (moveEvent: globalThis.PointerEvent) => {
                if (disposed) {
                    return;
                }
                moveEvent.preventDefault();
                void setRuntimeValue(
                    valueFromPointer(moveEvent.clientX, moveEvent.clientY, dragPointerOffset),
                    true,
                );
            };
            const onUp = () => {
                if (disposed) {
                    return;
                }
                disposed = true;
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                window.removeEventListener("pointercancel", onUp);
                void blueprintRuntime.dispatchElementBlueprintEvent(element.id, "dragEnd", {
                    value: valueRef.current,
                });
            };
            window.addEventListener("pointermove", onMove, { passive: false });
            window.addEventListener("pointerup", onUp, { once: true });
            window.addEventListener("pointercancel", onUp, { once: true });
        },
        [
            blueprintRuntime,
            element.id,
            handleElement?.id,
            hostApi,
            partIds,
            pointerOffsetFromHandleCenter,
            setRuntimeValue,
            valueFromPointer,
        ],
    );

    const handleOverride =
        trackElement && handleElement
            ? {
                  [handleElement.id]: {
                      ...handleElement,
                      layout: layoutWithSliderValue(
                          trackElement,
                          handleElement,
                          sliderProps.orientation,
                          normalizedValue,
                      ),
                      style: {
                          ...(handleElement.style ?? {}),
                          cursor: hostApi
                              ? sliderProps.orientation === "horizontal"
                                  ? "ew-resize"
                                  : "ns-resize"
                              : undefined,
                      },
                  },
              }
            : undefined;

    const hostStyle: CSSProperties = {
        position: "relative",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        overflow: "visible",
    };

    const fallbackTrackStyle: CSSProperties =
        sliderProps.orientation === "horizontal"
            ? {
                  position: "absolute",
                  left: 16,
                  right: 16,
                  top: "50%",
                  height: 6,
                  transform: "translateY(-50%)",
                  borderRadius: 999,
                  background: "rgba(148, 163, 184, 0.75)",
              }
            : {
                  position: "absolute",
                  top: 16,
                  bottom: 16,
                  left: "50%",
                  width: 6,
                  transform: "translateX(-50%)",
                  borderRadius: 999,
                  background: "rgba(148, 163, 184, 0.75)",
              };
    const fallbackHandleStyle: CSSProperties =
        sliderProps.orientation === "horizontal"
            ? {
                  position: "absolute",
                  left: `calc(16px + (100% - 32px) * ${normalizedValue})`,
                  top: "50%",
                  width: 18,
                  height: 22,
                  transform: "translate(-50%, -50%)",
                  borderRadius: 999,
                  background: "#f8fafc",
                  border: "1px solid rgba(15, 23, 42, 0.2)",
                  boxShadow: "0 4px 12px rgba(15, 23, 42, 0.28)",
              }
            : {
                  position: "absolute",
                  left: "50%",
                  top: `calc(16px + (100% - 32px) * ${1 - normalizedValue})`,
                  width: 22,
                  height: 18,
                  transform: "translate(-50%, -50%)",
                  borderRadius: 999,
                  background: "#f8fafc",
                  border: "1px solid rgba(15, 23, 42, 0.2)",
                  boxShadow: "0 4px 12px rgba(15, 23, 42, 0.28)",
              };

    return (
        <div ref={rootRef} style={hostStyle} onPointerDown={handlePointerDown}>
            {trackElement && renderChildren
                ? renderChildren({
                      childrenIds: [trackElement.id],
                      instanceKey: `slider-${element.id}`,
                  })
                : <div data-ui-slider-part="track" style={fallbackTrackStyle} />}
            {handleElement && renderChildren
                ? renderChildren({
                      childrenIds: [handleElement.id],
                      instanceKey: `slider-${element.id}`,
                      elementOverrides: handleOverride,
                  })
                : <div data-ui-slider-part="handle" style={fallbackHandleStyle} />}
        </div>
    );
}
