import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import type {
    UIListItemScope,
    UIListScrollbarPartStyle,
} from "@shared/types/ui-editor/list";
import { getUIListChildSlot } from "@shared/types/ui-editor/list";
import { DEFAULT_ELEMENT_EFFECT_VALUES } from "@shared/types/ui-editor/effects";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import {
    useWidgetRuntimeElementKey,
    useWidgetRuntimeSnapshot,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { composeListHostEffectStyle } from "@/lib/ui-editor/widget-modules/shared/effects/effectStyleComposer";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { getListProps, resolveListItemContentAlignmentStyle } from "./helpers";

type ScrollMetrics = {
    viewport: number;
    content: number;
    offset: number;
};

type ListItemEventPayload = {
    index: number;
    count: number;
    key: string;
    item: unknown;
};

type BlueprintRuntime = NonNullable<WidgetRendererProps["hostAdapter"]["blueprintRuntime"]>;

function listItemEventPayload(scope: UIListItemScope): ListItemEventPayload {
    return {
        index: scope.index,
        count: scope.count,
        key: scope.key,
        item: scope.item,
    };
}

function listItemProps(item: unknown): Record<string, unknown> {
    return item && typeof item === "object" && !Array.isArray(item)
        ? { ...(item as Record<string, unknown>) }
        : { value: item };
}

function ListItemRenderEvent(props: {
    runtime: BlueprintRuntime | undefined;
    elementId: string;
    scope: UIListItemScope;
}) {
    const { runtime, elementId, scope } = props;
    useEffect(() => {
        if (!runtime) {
            return;
        }
        void runtime.dispatchElementBlueprintEvent(elementId, "itemRender", listItemEventPayload(scope));
    }, [elementId, runtime, scope.count, scope.index, scope.item, scope.key]);

    return null;
}

function ListItemRefreshEvent(props: {
    runtime: BlueprintRuntime | undefined;
    elementIds: readonly string[];
    scope: UIListItemScope;
    instanceKey: string;
}) {
    const { runtime, elementIds, scope, instanceKey } = props;
    const elementKey = elementIds.join("\0");
    useEffect(() => {
        if (!runtime) {
            return;
        }
        const payload = {
            ...listItemEventPayload(scope),
            props: listItemProps(scope.item),
        };
        for (const elementId of elementIds) {
            void runtime.dispatchElementBlueprintEvent(elementId, "listItemRefresh", payload, {
                listItemScope: scope,
                instanceKey,
            });
        }
    }, [elementKey, instanceKey, runtime, scope.count, scope.index, scope.item, scope.key]);

    return null;
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

function collectElementDescendants(document: WidgetRendererProps["document"], rootIds: readonly string[]): string[] {
    const out: string[] = [];
    const visit = (id: string) => {
        const element = document.elements[id];
        if (!element) {
            return;
        }
        out.push(id);
        for (const childId of element.childrenIds ?? []) {
            visit(childId);
        }
    };
    for (const id of rootIds) {
        visit(id);
    }
    return out;
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

function axisSize(layout: UILayout, horizontal: boolean): number {
    return Math.max(1, Math.abs(horizontal ? layout.width : layout.height));
}

function scrollbarProgress(metrics: ScrollMetrics): number {
    const range = Math.max(0, metrics.content - metrics.viewport);
    return range > 0 ? metrics.offset / range : 0;
}

function layoutWithMainAxisOffset(layout: UILayout, horizontal: boolean, offset: number): UILayout {
    return horizontal
        ? { ...layout, x: layout.x + offset }
        : { ...layout, y: layout.y + offset };
}

function resolveAuthoredThumbLayout(
    track: UIElement,
    thumb: UIElement,
    horizontal: boolean,
    metrics: ScrollMetrics,
): UILayout {
    const travel = Math.max(0, axisSize(track.layout, horizontal) - axisSize(thumb.layout, horizontal));
    return layoutWithMainAxisOffset(thumb.layout, horizontal, scrollbarProgress(metrics) * travel);
}

export function ListRenderer(props: WidgetRendererProps) {
    const { element, document, hostAdapter, renderChildren, runtimeData } = props;
    const p = getListProps(element);
    const listHostRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const widgetRuntimeStore = useWidgetRuntimeStateStore();
    const runtimeElementKey = useWidgetRuntimeElementKey(element.id);
    const runtimeSnapshot = useWidgetRuntimeSnapshot();
    const runtimeListItems = runtimeSnapshot.listItems.get(runtimeElementKey);
    const runtimeSelectedIndex = runtimeSnapshot.listSelectedIndexes.get(runtimeElementKey);
    const runtimeScrollRequest = runtimeSnapshot.listScrollRequests.get(runtimeElementKey);
    const suppressContentClickRef = useRef(false);
    const reachedScrollEndRef = useRef(false);
    const selectedIndex = runtimeSelectedIndex ?? p.selectedIndex;
    const selectedIndexRef = useRef(selectedIndex);
    const horizontalScrollbar = p.scrollbar.side === "top" || p.scrollbar.side === "bottom";
    const metrics = useScrollMetrics(viewportRef, horizontalScrollbar);
    useEffect(() => {
        selectedIndexRef.current = selectedIndex;
    }, [selectedIndex]);
    useEffect(() => {
        if (!widgetRuntimeStore) {
            return undefined;
        }
        return () => {
            widgetRuntimeStore.clearListItems(runtimeElementKey);
        };
    }, [runtimeElementKey, widgetRuntimeStore]);
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
            const payload = {
                offset,
                maxOffset,
                progress,
            };
            void runtime.dispatchElementBlueprintEvent(element.id, "scroll", {
                ...payload,
            });
            const isAtEnd = maxOffset > 0 && offset >= maxOffset - 1;
            if (isAtEnd && !reachedScrollEndRef.current) {
                void runtime.dispatchElementBlueprintEvent(element.id, "scrollEnd", payload);
            }
            reachedScrollEndRef.current = isAtEnd;
        };
        viewport.addEventListener("scroll", dispatchScroll, { passive: true });
        return () => viewport.removeEventListener("scroll", dispatchScroll);
    }, [element.id, horizontalScrollbar, hostAdapter.blueprintRuntime]);
    const boundItems = resolveBoundItems(p, runtimeData);
    const items = runtimeListItems
        ? [...runtimeListItems]
        : boundItems ?? (p.previewItems.length > 0 ? p.previewItems : Array.from({ length: p.previewCount }, (_, i) => ({ index: i })));
    const count = Math.min(128, items.length);
    const itemTemplateIds = element.childrenIds.filter(childId => {
        const child = document.elements[childId];
        const slot = getUIListChildSlot(child?.extra);
        return slot == null || slot === "itemTemplate";
    });
    const itemTemplateDescendantIds = useMemo(
        () => collectElementDescendants(document, itemTemplateIds),
        [document, itemTemplateIds.join("\0")],
    );
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
    const listItemContentAlignment = resolveListItemContentAlignmentStyle(
        !horizontalScrollbar &&
            p.scrollbar.enabled &&
            p.scrollbar.visibility !== "hidden" &&
            p.scrollbar.side === "left",
        p.templateDirection,
    );
    const blueprintRuntime = hostAdapter.blueprintRuntime;
    const isRuntime = Boolean(blueprintRuntime);
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport || !runtimeScrollRequest) {
            return;
        }
        if (runtimeScrollRequest.kind === "top") {
            viewport.scrollTop = 0;
            viewport.scrollLeft = 0;
            return;
        }
        if (runtimeScrollRequest.kind === "bottom") {
            viewport.scrollTop = viewport.scrollHeight;
            viewport.scrollLeft = viewport.scrollWidth;
            return;
        }
        const target = viewport.querySelector<HTMLElement>(
            `[data-ui-list-item-index="${runtimeScrollRequest.index}"]`,
        );
        target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [runtimeScrollRequest?.version]);
    const dispatchListItemEvent = useCallback(
        (eventName: "itemClick" | "itemHover" | "selectionChanged", scope: UIListItemScope, extra?: Record<string, unknown>) => {
            if (!blueprintRuntime) {
                return;
            }
            void blueprintRuntime.dispatchElementBlueprintEvent(element.id, eventName, {
                ...listItemEventPayload(scope),
                ...extra,
            });
        },
        [blueprintRuntime, element.id],
    );
    const handleListItemClick = useCallback(
        (scope: UIListItemScope) => {
            dispatchListItemEvent("itemClick", scope);
            const previousIndex = selectedIndexRef.current;
            if (previousIndex === scope.index) {
                return;
            }
            selectedIndexRef.current = scope.index;
            widgetRuntimeStore?.setListSelectedIndex(runtimeElementKey, scope.index);
            dispatchListItemEvent("selectionChanged", scope, { previousIndex });
        },
        [dispatchListItemEvent, runtimeElementKey, widgetRuntimeStore],
    );
    const handleListItemHover = useCallback(
        (scope: UIListItemScope) => {
            dispatchListItemEvent("itemHover", scope);
        },
        [dispatchListItemEvent],
    );
    const listBody = items.slice(0, count).map((item, i) => {
        const key = itemKey(item, i, p.itemKeyPath);
        const instanceKey = `list-${element.id}-${key}`;
        const scope: UIListItemScope = { item, index: i, count, key };
        return (
            <div
                key={`${element.id}__list__${key}`}
                data-ui-list-item-key={key}
                data-ui-list-item-index={i}
                style={{
                    display: "flex",
                    flexDirection: innerDir,
                    gap: p.templateGap,
                    flexShrink: 0,
                    pointerEvents: isRuntime || i === 0 ? "auto" : "none",
                    ...listItemContentAlignment,
                }}
                onClick={isRuntime ? () => handleListItemClick(scope) : undefined}
                onPointerEnter={isRuntime ? () => handleListItemHover(scope) : undefined}
            >
                <ListItemRenderEvent runtime={blueprintRuntime} elementId={element.id} scope={scope} />
                <ListItemRefreshEvent
                    runtime={blueprintRuntime}
                    elementIds={itemTemplateDescendantIds}
                    scope={scope}
                    instanceKey={instanceKey}
                />
                {renderChildren?.({
                    childrenIds: itemTemplateIds,
                    listItemScope: scope,
                    instanceKey,
                })}
            </div>
        );
    });

    const scrollRange = Math.max(1, metrics.content - metrics.viewport);
    const fallbackTrackLength = Math.max(1, metrics.viewport - p.scrollbar.contentInset * 2);
    const fallbackThumbLength = Math.max(
        minThumbLength,
        Math.min(fallbackTrackLength, (metrics.viewport / Math.max(metrics.content, metrics.viewport)) * fallbackTrackLength),
    );
    const fallbackThumbTravel = Math.max(1, fallbackTrackLength - fallbackThumbLength);
    const fallbackThumbOffset = overflowAvailable ? (metrics.offset / scrollRange) * fallbackThumbTravel : 0;
    const authoredThumbLength = scrollbarThumbElement ? axisSize(scrollbarThumbElement.layout, horizontalScrollbar) : fallbackThumbLength;
    const authoredThumbTravel = scrollbarTrackElement
        ? Math.max(1, axisSize(scrollbarTrackElement.layout, horizontalScrollbar) - authoredThumbLength)
        : fallbackThumbTravel;

    const scrollToRatio = useCallback(
        (clientPosition: number, trackRect: DOMRect, thumbLength: number, thumbTravel: number) => {
            const viewport = viewportRef.current;
            if (!viewport) {
                return;
            }
            const trackStart = horizontalScrollbar ? trackRect.left : trackRect.top;
            const position = clientPosition - trackStart - thumbLength / 2;
            const ratio = Math.max(0, Math.min(1, position / Math.max(1, thumbTravel)));
            const nextOffset = ratio * scrollRange;
            if (horizontalScrollbar) {
                viewport.scrollLeft = nextOffset;
            } else {
                viewport.scrollTop = nextOffset;
            }
        },
        [horizontalScrollbar, scrollRange],
    );

    const startThumbDrag = useCallback(
        (event: PointerEvent<Element>, thumbTravel: number) => {
            event.preventDefault();
            event.stopPropagation();
            const viewport = viewportRef.current;
            if (!viewport) {
                return;
            }
            const startPointer = horizontalScrollbar ? event.clientX : event.clientY;
            const startOffset = horizontalScrollbar ? viewport.scrollLeft : viewport.scrollTop;
            const onMove = (moveEvent: globalThis.PointerEvent) => {
                moveEvent.preventDefault();
                const pointer = horizontalScrollbar ? moveEvent.clientX : moveEvent.clientY;
                const delta = pointer - startPointer;
                const ratioDelta = delta / Math.max(1, thumbTravel);
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
                window.removeEventListener("pointercancel", onUp);
            };
            window.addEventListener("pointermove", onMove, { passive: false });
            window.addEventListener("pointerup", onUp, { once: true });
            window.addEventListener("pointercancel", onUp, { once: true });
        },
        [horizontalScrollbar, scrollRange],
    );

    const handleFallbackThumbPointerDown = useCallback(
        (event: PointerEvent<HTMLDivElement>) => {
            const track = event.currentTarget.parentElement;
            if (!track) {
                return;
            }
            startThumbDrag(event, fallbackThumbTravel);
        },
        [fallbackThumbTravel, startThumbDrag],
    );

    const handleAuthoredScrollbarPointerDown = useCallback(
        (event: PointerEvent<HTMLDivElement>) => {
            if (!scrollbarTrackElement || !scrollbarThumbElement || event.button !== 0) {
                return;
            }
            const targetId = closestUiElementIdInSet(
                event.target,
                new Set([scrollbarTrackElement.id, scrollbarThumbElement.id]),
            );
            if (!targetId) {
                return;
            }
            const trackNode = findRenderedUiElement(listHostRef.current, scrollbarTrackElement.id);
            if (!trackNode) {
                return;
            }
            const trackRect = trackNode.getBoundingClientRect();
            if (targetId === scrollbarThumbElement.id) {
                startThumbDrag(event, authoredThumbTravel);
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            scrollToRatio(
                horizontalScrollbar ? event.clientX : event.clientY,
                trackRect,
                authoredThumbLength,
                authoredThumbTravel,
            );
        },
        [
            authoredThumbLength,
            authoredThumbTravel,
            horizontalScrollbar,
            scrollToRatio,
            scrollbarThumbElement,
            scrollbarTrackElement,
            startThumbDrag,
        ],
    );

    const handleContentDragPointerDown = useCallback(
        (event: PointerEvent<HTMLDivElement>) => {
            if (!p.dragContentScroll || event.button !== 0) {
                return;
            }
            const scrollbarIds = new Set(
                [scrollbarTrackElement?.id, scrollbarThumbElement?.id].filter((id): id is string => Boolean(id)),
            );
            if (closestUiElementIdInSet(event.target, scrollbarIds)) {
                return;
            }
            const viewport = viewportRef.current;
            if (!viewport) {
                return;
            }

            const useHorizontal = p.repeatDirection === "horizontal";
            const scrollable = useHorizontal
                ? viewport.scrollWidth > viewport.clientWidth + 1
                : viewport.scrollHeight > viewport.clientHeight + 1;
            if (!scrollable) {
                return;
            }

            const startX = event.clientX;
            const startY = event.clientY;
            const startScrollLeft = viewport.scrollLeft;
            const startScrollTop = viewport.scrollTop;
            const bodyStyle = globalThis.document.body.style;
            const originalUserSelect = bodyStyle.userSelect;
            const originalCursor = bodyStyle.cursor;
            let dragging = false;

            event.stopPropagation();

            const onMove = (moveEvent: globalThis.PointerEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                if (!dragging && Math.hypot(dx, dy) < 3) {
                    return;
                }
                if (!dragging) {
                    dragging = true;
                    suppressContentClickRef.current = true;
                    bodyStyle.userSelect = "none";
                    bodyStyle.cursor = "grabbing";
                }
                moveEvent.preventDefault();
                if (useHorizontal) {
                    viewport.scrollLeft = startScrollLeft - dx;
                } else {
                    viewport.scrollTop = startScrollTop - dy;
                }
            };

            const cleanup = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", cleanup);
                window.removeEventListener("pointercancel", cleanup);
                bodyStyle.userSelect = originalUserSelect;
                bodyStyle.cursor = originalCursor;
            };

            window.addEventListener("pointermove", onMove, { passive: false });
            window.addEventListener("pointerup", cleanup, { once: true });
            window.addEventListener("pointercancel", cleanup, { once: true });
        },
        [
            p.dragContentScroll,
            p.repeatDirection,
            scrollbarThumbElement?.id,
            scrollbarTrackElement?.id,
        ],
    );

    const handleContentDragClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (!suppressContentClickRef.current) {
            return;
        }
        suppressContentClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
    }, []);

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
              left: fallbackThumbOffset,
              top: 0,
              width: fallbackThumbLength,
              height: "100%",
          }
        : {
              top: fallbackThumbOffset,
              left: 0,
              width: "100%",
              height: fallbackThumbLength,
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

    const renderPart = (part: "track" | "thumb", style: UIListScrollbarPartStyle) => {
        const partElement = part === "track" ? fakeTrack : fakeThumb;
        return (
            <RectangleChromeRenderer
                {...props}
                element={partElement}
                children={null}
                rectangleLike={styleToRectangleLike(style)}
                clipContent={true}
            />
        );
    };

    const hasAuthoredScrollbar = Boolean(scrollbarTrackElement && scrollbarThumbElement && renderChildren);
    const authoredScrollbar =
        showScrollbar && hasAuthoredScrollbar && scrollbarTrackElement && scrollbarThumbElement && renderChildren ? (
            <>
                {renderChildren({
                    childrenIds: [scrollbarTrackElement.id],
                    instanceKey: `scrollbar-${element.id}`,
                })}
                {renderChildren({
                    childrenIds: [scrollbarThumbElement.id],
                    instanceKey: `scrollbar-${element.id}`,
                    elementOverrides: {
                        [scrollbarThumbElement.id]: {
                            ...scrollbarThumbElement,
                            layout: resolveAuthoredThumbLayout(
                                scrollbarTrackElement,
                                scrollbarThumbElement,
                                horizontalScrollbar,
                                metrics,
                            ),
                            style: {
                                ...(scrollbarThumbElement.style ?? {}),
                                cursor: horizontalScrollbar ? "ew-resize" : "ns-resize",
                            },
                        },
                    },
                })}
            </>
        ) : null;

    const fallbackScrollbar = showScrollbar && !hasAuthoredScrollbar ? (
        <div
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
                event.preventDefault();
                event.stopPropagation();
                scrollToRatio(
                    horizontalScrollbar ? event.clientX : event.clientY,
                    event.currentTarget.getBoundingClientRect(),
                    fallbackThumbLength,
                    fallbackThumbTravel,
                );
            }}
        >
            {renderPart("track", p.scrollbar.trackStyle)}
            <div
                data-ui-list-scrollbar-part="thumb"
                style={{
                    position: "absolute",
                    boxSizing: "border-box",
                    cursor: horizontalScrollbar ? "ew-resize" : "ns-resize",
                    ...thumbPlacement,
                }}
                onPointerDown={handleFallbackThumbPointerDown}
            >
                {renderPart("thumb", p.scrollbar.thumbStyle)}
            </div>
        </div>
    ) : null;

    const body = (
        <>
            <style>{`[data-ui-element-id="${element.id}"] [data-ui-list-viewport]::-webkit-scrollbar { display: none; }`}</style>
            <div
                ref={viewportRef}
                data-ui-list-viewport="true"
                style={viewportStyle}
                onPointerDown={handleContentDragPointerDown}
                onClickCapture={handleContentDragClickCapture}
            >
                <div style={flexHost}>{listBody}</div>
            </div>
            {authoredScrollbar}
            {fallbackScrollbar}
        </>
    );

    if (useClipIsolation) {
        return (
            <div style={hostStyle}>
                <div
                    ref={listHostRef}
                    style={{
                        position: "relative",
                        width: "100%",
                        height: "100%",
                        overflow: "hidden",
                        borderRadius: "inherit",
                    }}
                    onPointerDown={handleAuthoredScrollbarPointerDown}
                >
                    {body}
                </div>
            </div>
        );
    }

    return (
        <div ref={listHostRef} style={hostStyle} onPointerDown={handleAuthoredScrollbarPointerDown}>
            {body}
        </div>
    );
}
