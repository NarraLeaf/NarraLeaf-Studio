import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react";

export type StageViewportSize = { width: number; height: number };

export function isUsableSize(size: StageViewportSize | null | undefined): size is StageViewportSize {
    return Boolean(
        size &&
        Number.isFinite(size.width) &&
        Number.isFinite(size.height) &&
        size.width > 0 &&
        size.height > 0,
    );
}

export type StageViewportMetrics = {
    /** Scale from design units to the pixels the stage lays out at (what `getScale` should return). */
    renderScale: number;
    /** Backing box size in layout pixels. */
    backingWidth: number;
    backingHeight: number;
};

/**
 * Pure stage-sizing math shared by every run path: lay the stage out at `designSize` scaled to fit
 * the available `area` while preserving the design aspect ratio. `area` of `null`/0 falls back to
 * fit = 1 so nothing collapses to 0 before the first measurement.
 */
export function computeStageViewportMetrics(input: {
    area: StageViewportSize | null;
    designSize: StageViewportSize;
}): StageViewportMetrics {
    const dw = input.designSize.width > 0 ? input.designSize.width : 1;
    const dh = input.designSize.height > 0 ? input.designSize.height : 1;
    // Fall back to fit = 1 until a usable area is measured (a collapsed/0 dimension must not drive the
    // backing size to 0 or shrink the stage — see the runtime viewport sizing).
    const fit = isUsableSize(input.area)
        ? Math.min(input.area.width / dw, input.area.height / dh)
        : 1;
    return {
        renderScale: fit,
        backingWidth: dw * fit,
        backingHeight: dh * fit,
    };
}

export type StageViewportFrameProps = {
    /**
     * Logical design size the stage + surface content is authored in (the coordinate space).
     * Drives the aspect ratio and the backing scale.
     */
    designSize: StageViewportSize;
    /**
     * Reports the design → backing scale whenever it changes. Hosts feed this back into `getScale`
     * so the surface layers rasterize at the same backing resolution as the stage.
     */
    onRenderScaleChange?: (scale: number) => void;
    outerClassName?: string;
    outerStyle?: CSSProperties;
    boxClassName?: string;
    boxStyle?: CSSProperties;
    children?: ReactNode;
};

/**
 * Shared stage frame for every run path (Dev Mode + standalone runtime). Measures its own area and
 * lays the game content out in a `designSize × renderScale` box centred in that area, preserving the
 * design aspect ratio.
 */
export function StageViewportFrame(props: StageViewportFrameProps): ReactNode {
    const {
        designSize,
        onRenderScaleChange,
        outerClassName,
        outerStyle,
        boxClassName,
        boxStyle,
        children,
    } = props;

    const rootRef = useRef<HTMLDivElement | null>(null);
    const [area, setArea] = useState<StageViewportSize | null>(null);

    useLayoutEffect(() => {
        const node = rootRef.current;
        if (!node) {
            return;
        }
        const measure = () => {
            const width = node.clientWidth;
            const height = node.clientHeight;
            setArea(prev =>
                prev && prev.width === width && prev.height === height ? prev : { width, height },
            );
        };
        measure();
        if (typeof ResizeObserver === "undefined") {
            if (typeof window !== "undefined") {
                window.addEventListener("resize", measure);
                return () => window.removeEventListener("resize", measure);
            }
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const { renderScale, backingWidth, backingHeight } = computeStageViewportMetrics({
        area,
        designSize,
    });

    const reportRef = useRef(onRenderScaleChange);
    reportRef.current = onRenderScaleChange;
    useEffect(() => {
        reportRef.current?.(renderScale);
    }, [renderScale]);

    return (
        <div
            ref={rootRef}
            className={outerClassName}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                ...outerStyle,
            }}
        >
            <div
                className={boxClassName}
                style={{
                    position: "relative",
                    flex: "none",
                    width: backingWidth,
                    height: backingHeight,
                    overflow: "hidden",
                    ...boxStyle,
                }}
            >
                {children}
            </div>
        </div>
    );
}
