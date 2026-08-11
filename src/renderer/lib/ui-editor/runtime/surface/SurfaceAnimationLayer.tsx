import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
    type RefObject,
} from "react";
import { motion, useIsPresent } from "motion/react";
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
    presentZIndex?: number;
    exitZIndex?: number;
    resolveExit?: (direction: PageAnimationNavigationDirection) => Record<string, unknown>;
    onPrepaintReady?: (key: string) => void;
    onBeforeExit?: (key: string) => void;
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
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setReady(false);
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
                setReady(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [prepaintKey, rootRef]);

    return ready;
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
        presentZIndex = 10,
        exitZIndex = 20,
        resolveExit,
        onPrepaintReady,
        onBeforeExit,
        onEnterComplete,
        children,
    } = props;
    const contentRef = useRef<HTMLDivElement | null>(null);
    const beforeExitReportedRef = useRef<string | null>(null);
    const enterCompleteReportedRef = useRef<string | null>(null);
    const isPresent = useIsPresent();
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
        if (isPresent || beforeExitReportedRef.current === prepaintKey) {
            return;
        }
        beforeExitReportedRef.current = prepaintKey;
        onBeforeExit?.(prepaintKey);
    }, [isPresent, onBeforeExit, prepaintKey]);

    useEffect(() => {
        if (prepaintReady) {
            onPrepaintReady?.(prepaintKey);
        }
    }, [onPrepaintReady, prepaintKey, prepaintReady]);

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
            <div ref={contentRef} className={contentClassName} style={mergedContentStyle}>
                {/* Elements on this Surface start their own enter animations from the same instant
                    this layer becomes visible, not from when they mounted behind the curtain. */}
                <SurfaceEnterReadyContext.Provider value={prepaintReady}>
                    {children}
                </SurfaceEnterReadyContext.Provider>
            </div>
        </motion.div>
    );
}
