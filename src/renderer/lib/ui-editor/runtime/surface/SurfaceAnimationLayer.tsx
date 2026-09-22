import {
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ContextType,
    type CSSProperties,
    type ReactNode,
    type RefObject,
} from "react";
import { motion, PresenceContext, usePresence } from "motion/react";
import {
    scalePageMotionDistances,
    type PageAnimationMotion,
    type PageAnimationNavigationDirection,
} from "@/lib/ui-editor/runtime/pageAnimation";
import { SurfaceEnterReadyContext } from "@/lib/ui-editor/runtime/surface/ElementAnimationLayer";

export const SURFACE_PREPAINT_TIMEOUT_MS = 900;
/**
 * How long the hidden prepaint pass will wait for the layer's images before revealing anyway.
 *
 * Deliberately far below {@link SURFACE_PREPAINT_TIMEOUT_MS}, because the two waits are not worth
 * the same. A font that has not arrived restyles every line of text on the page and reflows it; an
 * image that has not arrived pops into a box that was already laid out. Holding the whole page back
 * for the second is the trade that made switching pages feel dead: a Load screen with save
 * screenshots on it measured 218ms between mounting and being allowed to show, during which the
 * player is still looking at the page they left, with nothing to say the click registered.
 *
 * Anything still decoding past this lands under the incoming page's enter animation, which is where
 * an author's transition can absorb it.
 */
const SURFACE_PREPAINT_IMAGE_TIMEOUT_MS = 120;
const SURFACE_PREPAINT_FRAME_TIMEOUT_MS = 50;
const SURFACE_ENTER_COMPLETE_FALLBACK_MS = 80;
/**
 * How long past the planned end of a departure the layer keeps waiting for the animations under it.
 *
 * The same slack the arrival above allows, and for the same reason: an animation is allowed to
 * overrun its plan by a frame or two, and a layer that stopped waiting on the exact millisecond
 * would cut the last one short.
 */
const SURFACE_EXIT_COMPLETE_FALLBACK_MS = 80;

type SurfaceAnimationLayerProps = {
    prepaintKey: string;
    direction: PageAnimationNavigationDirection;
    pageMotion: PageAnimationMotion;
    /**
     * Render scale applied to the page-animation travel distances (see
     * {@link scalePageMotionDistances}). Layers rendered OUTSIDE the design→backing scale
     * transform (the top-level surface stack) pass the host's render scale; layers inside the
     * scaled tree (nested surface frames) keep the default 1 so distances stay in design px.
     */
    scale?: number;
    className?: string;
    style?: CSSProperties;
    contentClassName?: string;
    contentStyle?: CSSProperties;
    surfaceId?: string;
    surfaceKind?: string;
    interactive?: boolean;
    /**
     * Take the whole layer out of hit testing while it plays its exit, so a press made during the
     * fade lands on whatever is drawn beneath it instead of on a page that has already gone.
     *
     * `pointer-events: none` on the layer does not do that. The elements inside it turn pointer
     * events back on for themselves - every widget wrapper does, so that a click stops where its
     * picture is, and so does the box a free-layout container lays its children out in - and a
     * leaving layer is drawn above the one arriving under it. So its invisible elements went on
     * taking every press over their area with no handler left to answer it. `inert` is the one
     * switch nothing inside the layer can turn back on.
     *
     * Opt-in, because whether a press may fall through depends on what the host draws underneath:
     * only a host that keeps such a press from reaching something that would misread it should turn
     * it on. The app's page stack guards the game stage for the length of an exit (see
     * `SurfaceStackBox`), and a frame keeps it from becoming a press on the frame (`FramePageBox`).
     */
    inertWhileLeaving?: boolean;
    presentZIndex?: number;
    exitZIndex?: number;
    /**
     * How long this layer's whole departure takes, its elements included - `exitMs` off the
     * animation plan. Defaults to the layer's own exit duration, which is the right answer for a
     * host whose elements do not animate.
     */
    exitHoldMs?: number;
    resolveExit?: (direction: PageAnimationNavigationDirection) => Record<string, unknown>;
    onPrepaintReady?: (key: string) => void;
    onBeforeExit?: (key: string) => void;
    /**
     * The layer was brought back before its exit finished, and is arriving again. Reported in the
     * commit that brings it back, before anything on it can be pressed, so a host can stop saying
     * the page is leaving from that moment rather than from when the return's enter animation ends.
     */
    onReturn?: (key: string) => void;
    onEnterComplete?: (key: string) => void;
    children: ReactNode;
};

function now(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

function waitForAnimationFrame(): Promise<void> {
    return new Promise(resolve => {
        let resolved = false;
        const timeoutId = setTimeout(() => {
            resolved = true;
            resolve();
        }, SURFACE_PREPAINT_FRAME_TIMEOUT_MS);

        if (typeof requestAnimationFrame !== "function") {
            return;
        }

        requestAnimationFrame(() => {
            if (resolved) {
                return;
            }
            resolved = true;
            clearTimeout(timeoutId);
            resolve();
        });
    });
}

function waitWithTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
        const timeoutId = setTimeout(resolve, timeoutMs);
        void promise
            .catch(() => undefined)
            .finally(() => {
                clearTimeout(timeoutId);
                resolve();
            });
    });
}

function waitForDocumentFonts(): Promise<unknown> {
    if (typeof document === "undefined") {
        return Promise.resolve();
    }
    const fontSet = document.fonts;
    return fontSet?.ready ?? Promise.resolve();
}

function waitForImages(root: HTMLElement | null): Promise<unknown> {
    if (!root) {
        return Promise.resolve();
    }
    const images = Array.from(root.querySelectorAll("img"));
    if (images.length === 0) {
        return Promise.resolve();
    }
    return Promise.all(images.map(image => {
        if (image.complete && image.naturalWidth > 0) {
            return Promise.resolve();
        }
        if (typeof image.decode === "function") {
            return image.decode().catch(() => undefined);
        }
        return new Promise<void>(resolve => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
        });
    }));
}

/**
 * A wait that resolved without the browser ever getting to paint is a wait that changed nothing.
 *
 * Below one frame at 60Hz: fonts already in the document and images already decoded settle inside
 * the same task, and on that path the second prepaint frame has nothing to reveal.
 */
const PREPAINT_ASSET_WAIT_SIGNIFICANT_MS = 16;

function useSurfacePrepaint(prepaintKey: string, rootRef: RefObject<HTMLDivElement | null>) {
    /**
     * The key the prepaint has finished for, rather than a flag: a new key starts hidden with no
     * reset step, and running the effect again for a key that has already painted finds nothing to
     * do. React does run it again - a development build replays every effect of a subtree it moves,
     * and the page stack moves the page it is leaving when Back returns to one still fading out. A
     * flag reset there hid a page that was on screen and replayed its enter animation over its exit,
     * which cut the exit short without ever finishing it: the page stayed on screen, leaving, for good.
     */
    const [readyKey, setReadyKey] = useState<string | null>(null);
    const readyKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (readyKeyRef.current === prepaintKey) {
            return undefined;
        }
        let cancelled = false;
        void (async () => {
            // One frame to let the freshly mounted (still hidden) surface lay out and paint. This is
            // the expensive one: on a busy page the browser needs 100ms+ to produce it, and that -
            // not asset loading - is what a page switch actually costs.
            await waitForAnimationFrame();
            const assetWaitStart = now();
            await Promise.all([
                waitWithTimeout(waitForDocumentFonts(), SURFACE_PREPAINT_TIMEOUT_MS),
                waitWithTimeout(waitForImages(rootRef.current), SURFACE_PREPAINT_IMAGE_TIMEOUT_MS),
            ]);
            // A second frame, but only when the waits above actually held something back. They
            // usually do not (fonts load once per session, images are decoded by the time the layer
            // is laid out), and waiting for a frame that has nothing to reveal cost another 100ms of
            // "the click did nothing" on exactly the pages that were already the slowest.
            if (now() - assetWaitStart >= PREPAINT_ASSET_WAIT_SIGNIFICANT_MS) {
                await waitForAnimationFrame();
            }
            if (!cancelled) {
                readyKeyRef.current = prepaintKey;
                setReadyKey(prepaintKey);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [prepaintKey, rootRef]);

    return readyKey === prepaintKey;
}

type PresenceValue = NonNullable<ContextType<typeof PresenceContext>>;

/**
 * The layer's own answer to "have my contents finished leaving", and the presence they report it to.
 *
 * The presence group above a layer settles only once every motion component under it has reported,
 * and one that never reports holds the group open for good. Under a Surface that is not a corner
 * case: an animated element that is hidden when the layer leaves has nothing to animate out and so
 * reports nothing, and one that is unmounted mid-exit never withdraws what it registered. A
 * blueprint hiding a container does both. What that costs is not cosmetic - the layer group's
 * settlement is the layer stack's only dequeue signal, so a layer stuck leaving strands `Hide Layer`
 * and holds its mutual-exclusion group shut, on top of leaving the layer's node on screen.
 *
 * So the layer answers for its contents rather than letting them answer for it. They get a presence
 * of their own, which reports upwards as soon as they have all settled - and, failing that, at the
 * planned end of the departure. The plan is the same number navigation settles page transitions on;
 * nothing here invents a duration.
 */
function useContentPresence(input: {
    isPresent: boolean;
    safeToRemove: (() => void) | null | undefined;
    exitHoldMs: number;
}): PresenceValue {
    const { isPresent, safeToRemove, exitHoldMs } = input;
    const parentPresence = useContext(PresenceContext);
    const fallbackId = useId();
    const registeredRef = useRef<Map<string | number, boolean> | null>(null);
    if (registeredRef.current === null) {
        registeredRef.current = new Map();
    }
    const registered = registeredRef.current;
    const reportedRef = useRef(false);
    const isPresentRef = useRef(isPresent);
    const safeToRemoveRef = useRef(safeToRemove);
    useEffect(() => {
        safeToRemoveRef.current = safeToRemove;
    });

    const report = useCallback(() => {
        if (reportedRef.current) {
            return;
        }
        reportedRef.current = true;
        safeToRemoveRef.current?.();
    }, []);

    const reportWhenSettled = useCallback(() => {
        if (isPresentRef.current) {
            return;
        }
        for (const settled of registered.values()) {
            if (!settled) {
                return;
            }
        }
        report();
    }, [registered, report]);

    useLayoutEffect(() => {
        isPresentRef.current = isPresent;
        if (isPresent) {
            reportedRef.current = false;
        }
        // Everything under the layer leaves again on the leaving pass, so what settled during its
        // stay says nothing about this departure.
        registered.forEach((_, key) => registered.set(key, false));
    }, [isPresent, registered]);

    useEffect(() => {
        if (isPresent) {
            return undefined;
        }
        // A layer with nothing animated under it is already done, and must not sit out the slack.
        reportWhenSettled();
        const timeoutId = setTimeout(report, exitHoldMs > 0 ? exitHoldMs + SURFACE_EXIT_COMPLETE_FALLBACK_MS : 0);
        return () => clearTimeout(timeoutId);
    }, [exitHoldMs, isPresent, report, reportWhenSettled]);

    /**
     * Everything but the bookkeeping is the presence above, verbatim: the contents still leave when
     * the layer does, and still skip the animations an arriving group skips. Read field by field so
     * this value survives a render of the group above - that one is rebuilt every time by design,
     * to drive layout animations no Surface has.
     */
    const parentId = parentPresence?.id;
    const parentInitial = parentPresence?.initial;
    const parentCustom = parentPresence?.custom;
    return useMemo<PresenceValue>(
        () => ({
            id: parentId ?? fallbackId,
            initial: parentInitial,
            custom: parentCustom,
            isPresent,
            onExitComplete: childId => {
                if (registered.has(childId)) {
                    registered.set(childId, true);
                }
                reportWhenSettled();
            },
            register: childId => {
                registered.set(childId, false);
                return () => {
                    registered.delete(childId);
                    reportWhenSettled();
                };
            },
        }),
        [fallbackId, isPresent, parentCustom, parentId, parentInitial, registered, reportWhenSettled],
    );
}

export function SurfaceAnimationLayer(props: SurfaceAnimationLayerProps) {
    const {
        prepaintKey,
        direction,
        pageMotion,
        scale = 1,
        className,
        style,
        contentClassName,
        contentStyle,
        surfaceId,
        surfaceKind,
        interactive = true,
        inertWhileLeaving = false,
        presentZIndex = 10,
        exitZIndex = 20,
        exitHoldMs,
        resolveExit,
        onPrepaintReady,
        onBeforeExit,
        onReturn,
        onEnterComplete,
        children,
    } = props;
    const contentRef = useRef<HTMLDivElement | null>(null);
    const beforeExitReportedRef = useRef<string | null>(null);
    const enterCompleteReportedRef = useRef<string | null>(null);
    const [isPresent, safeToRemove] = usePresence();
    const contentPresence = useContentPresence({
        isPresent,
        safeToRemove,
        exitHoldMs: Math.max(0, exitHoldMs ?? pageMotion.exitDurationMs),
    });
    const prepaintReady = useSurfacePrepaint(prepaintKey, contentRef);
    // Snapshot of `prepaintReady` taken while the layer was still present. Exit visibility uses
    // this instead of live state: a layer removed before its prepaint ever completed has never
    // been shown, and forcing it visible for the exit would flash never-painted content (still
    // posed at its enter-initial target) for the duration of the exit animation.
    const prepaintReadyWhilePresentRef = useRef(false);
    useLayoutEffect(() => {
        if (isPresent) {
            prepaintReadyWhilePresentRef.current = prepaintReady;
        }
    }, [isPresent, prepaintReady]);

    const reportEnterComplete = useCallback(() => {
        if (enterCompleteReportedRef.current === prepaintKey) {
            return;
        }
        enterCompleteReportedRef.current = prepaintKey;
        onEnterComplete?.(prepaintKey);
    }, [onEnterComplete, prepaintKey]);

    useEffect(() => {
        beforeExitReportedRef.current = null;
        enterCompleteReportedRef.current = null;
    }, [prepaintKey]);

    useLayoutEffect(() => {
        if (isPresent) {
            // Back before its exit finished. A presence group whose child's key comes back while the
            // child is still leaving brings that same child back rather than mounting a new one -
            // which is what going Back to a page that is still fading out does. The page has arrived
            // again, so its next departure is announced and its arrival counted as if it were new.
            if (beforeExitReportedRef.current === prepaintKey) {
                beforeExitReportedRef.current = null;
                enterCompleteReportedRef.current = null;
                onReturn?.(prepaintKey);
            }
            return;
        }
        if (beforeExitReportedRef.current === prepaintKey) {
            return;
        }
        beforeExitReportedRef.current = prepaintKey;
        onBeforeExit?.(prepaintKey);
    }, [isPresent, onBeforeExit, onReturn, prepaintKey]);

    /**
     * Report the layer painted - and again when it comes back from an exit it did not finish.
     *
     * The second report is what lets the host finish the navigation that brought it back. A page
     * lane keeps the page it is leaving drawn over the one it is going to until that one reports its
     * prepaint, and a layer brought back is already painted, so it had nothing new to report: the
     * page it was returning to stayed drawn on top of it for good, and since input belongs to the
     * page being returned to, nothing on screen answered a press or a key again.
     */
    useEffect(() => {
        if (prepaintReady && isPresent) {
            onPrepaintReady?.(prepaintKey);
        }
    }, [isPresent, onPrepaintReady, prepaintKey, prepaintReady]);

    useEffect(() => {
        if (prepaintReady && isPresent && pageMotion.enterDurationMs <= 0) {
            reportEnterComplete();
        }
    }, [isPresent, pageMotion.enterDurationMs, prepaintReady, reportEnterComplete]);

    useEffect(() => {
        if (!prepaintReady || !isPresent || pageMotion.enterDurationMs <= 0) {
            return undefined;
        }
        const timeoutId = setTimeout(
            reportEnterComplete,
            pageMotion.enterDurationMs + SURFACE_ENTER_COMPLETE_FALLBACK_MS,
        );
        return () => clearTimeout(timeoutId);
    }, [isPresent, pageMotion.enterDurationMs, prepaintReady, reportEnterComplete]);

    const variants = useMemo(() => {
        const prepaintTarget = {
            ...scalePageMotionDistances(pageMotion.initial, scale),
            transition: { type: "tween", duration: 0 },
        };
        const exitForDirection = (navDirection: PageAnimationNavigationDirection) => ({
            ...scalePageMotionDistances(resolveExit?.(navDirection) ?? pageMotion.exit, scale),
            pointerEvents: "none",
        });
        return {
            prepaint: prepaintTarget,
            animate: scalePageMotionDistances(pageMotion.animate, scale),
            exit: exitForDirection,
        };
    }, [pageMotion.animate, pageMotion.exit, pageMotion.initial, resolveExit, scale]);

    const mergedStyle: CSSProperties = {
        ...style,
        zIndex: isPresent ? presentZIndex : exitZIndex,
        pointerEvents: isPresent && prepaintReady && interactive ? style?.pointerEvents : "none",
    };
    const contentVisible = isPresent ? prepaintReady : prepaintReadyWhilePresentRef.current;
    const mergedContentStyle: CSSProperties = {
        ...contentStyle,
        opacity: contentVisible ? contentStyle?.opacity ?? 1 : 0,
    };

    return (
        <motion.div
            className={className}
            style={mergedStyle}
            custom={direction}
            variants={variants}
            initial={false}
            animate={prepaintReady ? "animate" : "prepaint"}
            exit="exit"
            data-ui-surface-id={surfaceId}
            data-ui-surface-kind={surfaceKind}
            data-ui-surface-prepaint={prepaintReady ? "ready" : "pending"}
            onAnimationComplete={definition => {
                if (definition === "animate" && prepaintReady && isPresent) {
                    reportEnterComplete();
                }
            }}
        >
            <div
                ref={contentRef}
                className={contentClassName}
                style={mergedContentStyle}
                // On the content rather than the animated node: everything that can take a press is
                // in here, and this is a plain element, so the attribute is written as React writes it.
                inert={inertWhileLeaving && !isPresent}
            >
                {/* Elements on this Surface start their own enter animations from the same instant
                    this layer becomes visible, not from when they mounted behind the curtain. */}
                <SurfaceEnterReadyContext.Provider value={prepaintReady}>
                    <PresenceContext.Provider value={contentPresence}>
                        {children}
                    </PresenceContext.Provider>
                </SurfaceEnterReadyContext.Provider>
            </div>
        </motion.div>
    );
}
