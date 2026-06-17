import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { UIElement } from "@shared/types/ui-editor/document";
import type {
    UIListItemScope,
    UIListScrollbarPartStyle,
} from "@shared/types/ui-editor/list";
import { getUIListChildSlot } from "@shared/types/ui-editor/list";
import { DEFAULT_ELEMENT_EFFECT_VALUES } from "@shared/types/ui-editor/effects";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { composeListHostEffectStyle } from "@/lib/ui-editor/widget-modules/shared/effects/effectStyleComposer";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { getListProps } from "./helpers";

type ScrollMetrics = {
    viewport: number;
    content: number;
    offset: number;
};

function readPath(source: unknown, path: string): unknown {
    const clean = path.trim();
    if (!clean) {
        return undefined;
    }
    return clean.split(".").reduce<unknown>((current, segment) => {
        if (current == null || !segment) {
            return undefined;
        }
        if (Array.isArray(current)) {
            const index = Number(segment);
            return Number.isInteger(index) ? current[index] : undefined;
        }
        if (typeof current === "object") {
            return (current as Record<string, unknown>)[segment];
        }
        return undefined;
    }, source);
}

function itemKey(item: unknown, index: number, path: string | undefined): string {
    const raw = path ? readPath(item, path) : undefined;
    if (typeof raw === "string" || typeof raw === "number") {
        return String(raw);
    }
    return String(index);
}

function styleToRectangleLike(style: UIListScrollbarPartStyle): RectangleLikeProps {
    return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        borderRadiusTL: style.borderRadius,
        borderRadiusTR: style.borderRadius,
        borderRadiusBL: style.borderRadius,
        borderRadiusBR: style.borderRadius,
        borderRadiusLinked: true,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        borderStyle: style.borderStyle,
        backgroundImage: style.backgroundImage,
        backgroundFit: style.backgroundFit,
        imageFill: style.imageFill,
        fillType: style.fillType,
        fillVisible: true,
        fillOpacity: style.fillOpacity,
        strokeVisible: style.borderWidth > 0,
        strokeOpacity: 1,
        strokeAlign: "inside",
        strokeSide: "all",
        borderJoin: "round",
        cornerAdvanced: false,
        transformOffsetX: 0,
        transformOffsetY: 0,
        transformScale: 1,
        transformRotation: 0,
        transformOpacity: 1,
        effects: { ...DEFAULT_ELEMENT_EFFECT_VALUES },
    };
}

function resolveBoundItems(props: ReturnType<typeof getListProps>, runtimeData: WidgetRendererProps["runtimeData"]): unknown[] | null {
    const binding = props.itemsBinding;
    if (!binding) {
        return null;
    }
    const source =
        binding.kind === "globalState"
            ? runtimeData?.globalState?.get(binding.key)
            : runtimeData?.surfaceState?.get(binding.key);
    return Array.isArray(source) ? source : null;
}

function useScrollMetrics(ref: React.RefObject<HTMLDivElement | null>, horizontal: boolean): ScrollMetrics {
    const [metrics, setMetrics] = useState<ScrollMetrics>({ viewport: 1, content: 1, offset: 0 });
    const update = useCallback(() => {
        const el = ref.current;
        if (!el) {
            return;
        }
        const viewport = horizontal ? el.clientWidth : el.clientHeight;
        const content = horizontal ? el.scrollWidth : el.scrollHeight;
        const offset = horizontal ? el.scrollLeft : el.scrollTop;
        setMetrics({
            viewport: Math.max(1, viewport),
            content: Math.max(1, content),
            offset: Math.max(0, offset),
        });
    }, [horizontal, ref]);

    useEffect(() => {
        update();
        const el = ref.current;
        if (!el) {
            return;
        }
        const ro = new ResizeObserver(update);
        ro.observe(el);
        if (el.firstElementChild) {
            ro.observe(el.firstElementChild);
        }
        el.addEventListener("scroll", update, { passive: true });
        return () => {
            ro.disconnect();
            el.removeEventListener("scroll", update);
        };
    }, [update, ref]);

    return metrics;
}

export function ListRenderer(props: WidgetRendererProps) {
    const { element, document, hostAdapter, renderChildren, runtimeData } = props;
    const p = getListProps(element);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const horizontalScrollbar = p.scrollbar.side === "top" || p.scrollbar.side === "bottom";
    const metrics = useScrollMetrics(viewportRef, horizontalScrollbar);
    useEffect(() => {
        const runtime = hostAdapter.blueprintRuntime;
        const viewport = viewportRef.current;
        if (!runtime || !viewport) {
            return undefined;
        }
        const dispatchScroll = () => {
            const viewportSize = horizontalScrollbar ? viewport.clientWidth : viewport.clientHeight;
            const contentSize = horizontalScrollbar ? viewport.scrollWidth : viewport.scrollHeight;
            const offset = horizontalScrollbar ? viewport.scrollLeft : viewport.scrollTop;
            const maxOffset = Math.max(0, contentSize - viewportSize);
            const progress = maxOffset > 0 ? offset / maxOffset : 0;
            void runtime.dispatchElementBlueprintEvent(element.id, "scroll", {
                offset,
                maxOffset,
                progress,
            });
        };
        viewport.addEventListener("scroll", dispatchScroll, { passive: true });
        return () => viewport.removeEventListener("scroll", dispatchScroll);
    }, [element.id, horizontalScrollbar, hostAdapter.blueprintRuntime]);
    const runtimeItems = resolveBoundItems(p, runtimeData);
    const items = runtimeItems ?? (p.previewItems.length > 0 ? p.previewItems : Array.from({ length: p.previewCount }, (_, i) => ({ index: i })));
    const count = Math.max(1, Math.min(128, items.length));
    const itemTemplateIds = element.childrenIds.filter(childId => {
        const child = document.elements[childId];
        const slot = getUIListChildSlot(child?.extra);
        return slot == null || slot === "itemTemplate";
    });
    const scrollbarTrackElement =
        (p.scrollbar.trackElementId ? document.elements[p.scrollbar.trackElementId] : undefined) ??
        element.childrenIds
            .map(id => document.elements[id])
            .find(child => getUIListChildSlot(child?.extra) === "scrollbarTrack");
    const scrollbarThumbElement =
        (p.scrollbar.thumbElementId ? document.elements[p.scrollbar.thumbElementId] : undefined) ??
        element.childrenIds
            .map(id => document.elements[id])
            .find(child => getUIListChildSlot(child?.extra) === "scrollbarThumb");
    const scrollbarThickness = Math.max(
        2,
        horizontalScrollbar
            ? Math.abs(scrollbarTrackElement?.layout.height ?? p.scrollbar.thickness)
            : Math.abs(scrollbarTrackElement?.layout.width ?? p.scrollbar.thickness),
    );
    const minThumbLength = Math.max(
        8,
        horizontalScrollbar
            ? Math.abs(scrollbarThumbElement?.layout.width ?? p.scrollbar.minThumbLength)
            : Math.abs(scrollbarThumbElement?.layout.height ?? p.scrollbar.minThumbLength),
    );

    const effectStyle = composeListHostEffectStyle(p.effects);
    const hasVisualOverflowEffects =
        Boolean(effectStyle.boxShadow) ||
        Boolean(effectStyle.filter) ||
        Boolean(effectStyle.backdropFilter);
    const useClipIsolation = hasVisualOverflowEffects;
    const overflowAvailable = metrics.content > metrics.viewport + 1;
    const showScrollbar =
        p.scrollbar.enabled &&
        p.scrollbar.visibility !== "hidden" &&
        (p.scrollbar.visibility === "always" || overflowAvailable);
    const reserveScrollbar = showScrollbar ? scrollbarThickness + p.scrollbar.contentInset : 0;
    const reserveRight = !horizontalScrollbar && p.scrollbar.side === "right" ? reserveScrollbar : 0;
    const reserveLeft = !horizontalScrollbar && p.scrollbar.side === "left" ? reserveScrollbar : 0;
    const reserveTop = horizontalScrollbar && p.scrollbar.side === "top" ? reserveScrollbar : 0;
    const reserveBottom = horizontalScrollbar && p.scrollbar.side === "bottom" ? reserveScrollbar : 0;

    const hostStyle: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        overflow: useClipIsolation ? "visible" : "hidden",
        ...effectStyle,
    };

    const viewportStyle: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        overflowX: p.repeatDirection === "horizontal" ? "auto" : "hidden",
        overflowY: p.repeatDirection === "vertical" ? "auto" : "hidden",
        scrollbarWidth: "none",
        paddingTop: p.contentPaddingTop + reserveTop,
        paddingRight: p.contentPaddingRight + reserveRight,
        paddingBottom: p.contentPaddingBottom + reserveBottom,
        paddingLeft: p.contentPaddingLeft + reserveLeft,
    };

    const flexHost: CSSProperties = {
        display: "flex",
        flexDirection: p.repeatDirection === "vertical" ? "column" : "row",
        gap: p.itemGap,
        alignItems: "stretch",
        minWidth: p.repeatDirection === "vertical" ? "100%" : 0,
        minHeight: p.repeatDirection === "horizontal" ? "100%" : 0,
    };

    const innerDir = p.templateDirection === "horizontal" ? "row" : "column";
    const isRuntime = Boolean(hostAdapter.blueprintRuntime);
    const listBody = items.slice(0, count).map((item, i) => {
        const key = itemKey(item, i, p.itemKeyPath);
        const scope: UIListItemScope = { item, index: i, count, key };
        return (
            <div
                key={`${element.id}__list__${key}`}
                data-ui-list-item-key={key}
                style={{
                    display: "flex",
                    flexDirection: innerDir,
                    gap: p.templateGap,
                    flexShrink: 0,
                    pointerEvents: isRuntime || i === 0 ? "auto" : "none",
                }}
            >
                {renderChildren?.({
                    childrenIds: itemTemplateIds,
                    listItemScope: scope,
                    instanceKey: `list-${element.id}-${key}`,
                })}
            </div>
        );
    });

    const scrollRange = Math.max(1, metrics.content - metrics.viewport);
    const trackLength = Math.max(1, metrics.viewport - p.scrollbar.contentInset * 2);
    const thumbLength = Math.max(
        minThumbLength,
        Math.min(trackLength, (metrics.viewport / Math.max(metrics.content, metrics.viewport)) * trackLength),
    );
    const thumbTravel = Math.max(1, trackLength - thumbLength);
    const thumbOffset = overflowAvailable ? (metrics.offset / scrollRange) * thumbTravel : 0;

    const scrollToRatio = useCallback(
        (clientPosition: number, trackRect: DOMRect) => {
            const viewport = viewportRef.current;
            if (!viewport) {
                return;
            }
            const trackStart = horizontalScrollbar ? trackRect.left : trackRect.top;
            const position = clientPosition - trackStart - thumbLength / 2;
            const ratio = Math.max(0, Math.min(1, position / thumbTravel));
            const nextOffset = ratio * scrollRange;
            if (horizontalScrollbar) {
                viewport.scrollLeft = nextOffset;
            } else {
                viewport.scrollTop = nextOffset;
            }
        },
        [horizontalScrollbar, scrollRange, thumbLength, thumbTravel],
    );

    const handleThumbPointerDown = useCallback(
        (event: PointerEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const viewport = viewportRef.current;
            const track = event.currentTarget.parentElement;
            if (!viewport || !track) {
                return;
            }
            const trackRect = track.getBoundingClientRect();
            const startPointer = horizontalScrollbar ? event.clientX : event.clientY;
            const startOffset = horizontalScrollbar ? viewport.scrollLeft : viewport.scrollTop;
            const onMove = (moveEvent: globalThis.PointerEvent) => {
                const pointer = horizontalScrollbar ? moveEvent.clientX : moveEvent.clientY;
                const delta = pointer - startPointer;
                const ratioDelta = delta / Math.max(1, trackRect[horizontalScrollbar ? "width" : "height"] - thumbLength);
                const nextOffset = startOffset + ratioDelta * scrollRange;
                if (horizontalScrollbar) {
                    viewport.scrollLeft = nextOffset;
                } else {
                    viewport.scrollTop = nextOffset;
                }
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp, { once: true });
        },
        [horizontalScrollbar, scrollRange, thumbLength],
    );

    const trackPlacement: CSSProperties = horizontalScrollbar
        ? {
              left: p.scrollbar.contentInset,
              right: p.scrollbar.contentInset,
              height: scrollbarThickness,
              [p.scrollbar.side]: p.scrollbar.contentInset,
          }
        : {
              top: p.scrollbar.contentInset,
              bottom: p.scrollbar.contentInset,
              width: scrollbarThickness,
              [p.scrollbar.side]: p.scrollbar.contentInset,
          };

    const thumbPlacement: CSSProperties = horizontalScrollbar
        ? {
              left: thumbOffset,
              top: 0,
              width: thumbLength,
              height: "100%",
          }
        : {
              top: thumbOffset,
              left: 0,
              width: "100%",
              height: thumbLength,
          };

    const fakeTrack: UIElement = {
        id: `${element.id}:scrollbarTrack`,
        type: "nl.container",
        parentId: element.id,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 1, height: 1, visible: true, opacity: 1 },
        props: {},
    };
    const fakeThumb: UIElement = {
        ...fakeTrack,
        id: `${element.id}:scrollbarThumb`,
    };

    const renderPart = (part: "track" | "thumb", authored: UIElement | undefined, style: UIListScrollbarPartStyle) => {
        const partElement = authored ?? (part === "track" ? fakeTrack : fakeThumb);
        return (
            <RectangleChromeRenderer
                {...props}
                element={partElement}
                children={null}
                rectangleLike={authored ? undefined : styleToRectangleLike(style)}
                clipContent={true}
            />
        );
    };

    const scrollbar = showScrollbar ? (
        <div
            data-ui-element-id={scrollbarTrackElement?.id}
            data-ui-list-scrollbar-part="track"
            style={{
                position: "absolute",
                boxSizing: "border-box",
                ...trackPlacement,
            }}
            onPointerDown={event => {
                if (event.target !== event.currentTarget) {
                    return;
                }
                scrollToRatio(horizontalScrollbar ? event.clientX : event.clientY, event.currentTarget.getBoundingClientRect());
            }}
        >
            {renderPart("track", scrollbarTrackElement, p.scrollbar.trackStyle)}
            <div
                data-ui-element-id={scrollbarThumbElement?.id}
                data-ui-list-scrollbar-part="thumb"
                style={{
                    position: "absolute",
                    boxSizing: "border-box",
                    cursor: horizontalScrollbar ? "ew-resize" : "ns-resize",
                    ...thumbPlacement,
                }}
                onPointerDown={handleThumbPointerDown}
            >
                {renderPart("thumb", scrollbarThumbElement, p.scrollbar.thumbStyle)}
            </div>
        </div>
    ) : null;

    const body = (
        <>
            <style>{`[data-ui-element-id="${element.id}"] [data-ui-list-viewport]::-webkit-scrollbar { display: none; }`}</style>
            <div ref={viewportRef} data-ui-list-viewport="true" style={viewportStyle}>
                <div style={flexHost}>{listBody}</div>
            </div>
            {scrollbar}
        </>
    );

    if (useClipIsolation) {
        return (
            <div style={hostStyle}>
                <div
                    style={{
                        position: "relative",
                        width: "100%",
                        height: "100%",
                        overflow: "hidden",
                        borderRadius: "inherit",
                    }}
                >
                    {body}
                </div>
            </div>
        );
    }

    return <div style={hostStyle}>{body}</div>;
}
