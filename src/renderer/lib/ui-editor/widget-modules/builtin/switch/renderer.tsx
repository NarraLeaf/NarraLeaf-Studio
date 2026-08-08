import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
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
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import {
    useWidgetRuntimeElementKey,
    useWidgetRuntimeSnapshot,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { getSwitchProps } from "./helpers";

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

/** Flips one part to its `on` appearance variant. Geometry is deliberately left untouched. */
function withOnVariant(element: UIElement): UIElement {
    return {
        ...element,
        extra: {
            ...(element.extra ?? {}),
            runtimeVariantOverrideId: UI_SWITCH_ON_VARIANT_ID,
        },
    };
}

/**
 * The switch owns no geometry at all: on/off is an appearance variant on each part (the track's
 * colour, the thumb's `transformOffsetX`), so this renderer only decides *which variant* the two
 * parts resolve with and dispatches the blueprint events. Compare `slider/renderer.tsx`, which has
 * to compute the handle's position on every render.
 */
export function SwitchRenderer(props: WidgetRendererProps) {
    const { element, document, hostAdapter, renderChildren } = props;
    const flushFrameRef = useRef<number | null>(null);
    // A toggle whose graph is still running swallows further toggles rather than queueing them:
    // unlike the slider there is no stream of values to coalesce, and running the same graph
    // concurrently from a double click is the failure this guards.
    const toggleInFlightRef = useRef(false);
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

    const toggle = useCallback(() => {
        if (!canRunSwitchInteraction || !runtimeStore || !blueprintRuntime) {
            return;
        }
        if (toggleInFlightRef.current) {
            return;
        }
        const previousChecked = checkedRef.current;
        const next = runtimeStore.setSwitchProperties(runtimeElementKey, authoredProps, {
            checked: !previousChecked,
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
    }, [
        authoredProps,
        blueprintRuntime,
        canRunSwitchInteraction,
        element.id,
        runtimeElementKey,
        runtimeStore,
        scheduleSwitchFlush,
    ]);

    const handlePointerDown = useCallback(
        (event: PointerEvent<HTMLDivElement>) => {
            if (!canRunSwitchInteraction || event.button !== 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            toggle();
        },
        [canRunSwitchInteraction, toggle],
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
    const elementOverrides = checked
        ? Object.fromEntries(
              [trackElement, thumbElement]
                  .filter((part): part is UIElement => Boolean(part))
                  .map(part => [part.id, withOnVariant(part)]),
          )
        : undefined;

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
        background: checked ? "rgba(59, 130, 246, 0.9)" : "rgba(100, 116, 139, 0.75)",
    };
    const fallbackThumbStyle: CSSProperties = {
        position: "absolute",
        top: 3,
        bottom: 3,
        left: checked ? "auto" : 3,
        right: checked ? 3 : "auto",
        aspectRatio: "1 / 1",
        borderRadius: 999,
        background: "#f8fafc",
        border: "1px solid rgba(15, 23, 42, 0.2)",
    };

    return (
        <div
            style={hostStyle}
            role="switch"
            aria-checked={checked}
            aria-disabled={canRunSwitchInteraction ? undefined : true}
            data-ui-switch-checked={checked ? "true" : "false"}
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
