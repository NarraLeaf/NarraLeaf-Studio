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
import type {
    PageAnimationMotion,
    PageAnimationNavigationDirection,
} from "@/lib/ui-editor/runtime/pageAnimation";

export const SURFACE_PREPAINT_TIMEOUT_MS = 900;
const SURFACE_PREPAINT_FRAME_TIMEOUT_MS = 50;
const SURFACE_ENTER_COMPLETE_FALLBACK_MS = 80;

type SurfaceAnimationLayerProps = {
    prepaintKey: string;
    direction: PageAnimationNavigationDirection;
    pageMotion: PageAnimationMotion;
    className?: string;
    style?: CSSProperties;
    contentClassName?: string;
    contentStyle?: CSSProperties;
    surfaceId?: string;
    surfaceKind?: string;
    presentZIndex?: number;
    exitZIndex?: number;
    resolveExit?: (direction: PageAnimationNavigationDirection) => Record<string, unknown>;
    onPrepaintReady?: (key: string) => void;
    onBeforeExit?: (key: string) => void;
    onEnterComplete?: (key: string) => void;
    children: ReactNode;
};

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

function useSurfacePrepaint(prepaintKey: string, rootRef: RefObject<HTMLDivElement | null>) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setReady(false);
        void (async () => {
            await waitForAnimationFrame();
            await waitWithTimeout(
                Promise.all([
                    waitForDocumentFonts(),
                    waitForImages(rootRef.current),
                ]),
                SURFACE_PREPAINT_TIMEOUT_MS,
            );
            await waitForAnimationFrame();
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
        className,
        style,
        contentClassName,
        contentStyle,
        surfaceId,
        surfaceKind,
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
            ...pageMotion.initial,
            transition: { type: "tween", duration: 0 },
        };
        const exitForDirection = (navDirection: PageAnimationNavigationDirection) => ({
            ...(resolveExit?.(navDirection) ?? pageMotion.exit),
            pointerEvents: "none",
        });
        return {
            prepaint: prepaintTarget,
            animate: pageMotion.animate,
            exit: exitForDirection,
        };
    }, [pageMotion.animate, pageMotion.exit, pageMotion.initial, resolveExit]);

    const mergedStyle: CSSProperties = {
        ...style,
        zIndex: isPresent ? presentZIndex : exitZIndex,
        pointerEvents: isPresent && prepaintReady ? style?.pointerEvents : "none",
    };
    const mergedContentStyle: CSSProperties = {
        ...contentStyle,
        opacity: prepaintReady || !isPresent ? contentStyle?.opacity ?? 1 : 0,
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
                {children}
            </div>
        </motion.div>
    );
}
