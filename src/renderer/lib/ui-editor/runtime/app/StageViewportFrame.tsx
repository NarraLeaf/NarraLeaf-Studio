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
    /** CSS scale applied to the backing box to fill the fit size. 1 when unclamped. */
    displayScale: number;
    /** Backing box size in layout pixels (the resolution the browser rasterizes at). */
    backingWidth: number;
    backingHeight: number;
};

/**
 * Pure stage-sizing math shared by every run path. Without `outputResolution` the backing box is the
 * fit size (native rendering, displayScale 1). With it, the box is fixed at the target resolution and
 * `displayScale` upscales it to the fit size — true downsample-to-target (or supersample when the
 * target exceeds the fit size). `area` of `null`/0 falls back to fit = 1 so nothing collapses to 0
 * before the first measurement.
 */
export function computeStageViewportMetrics(input: {
    area: StageViewportSize | null;
    designSize: StageViewportSize;
    outputResolution?: StageViewportSize | null;
}): StageViewportMetrics {
    const dw = input.designSize.width > 0 ? input.designSize.width : 1;
    const dh = input.designSize.height > 0 ? input.designSize.height : 1;
    const fit = input.area
        ? Math.max(0, Math.min(input.area.width / dw, input.area.height / dh))
        : 1;
    const clamp = isUsableSize(input.outputResolution) ? input.outputResolution : null;
    // When clamped, the target width is authoritative — its aspect matches the design (callers reject
    // mismatches), so the height agrees.
    const renderScale = clamp ? clamp.width / dw : fit;
    return {
        renderScale,
        displayScale: renderScale > 0 ? fit / renderScale : 1,
        backingWidth: dw * renderScale,
        backingHeight: dh * renderScale,
    };
}

export type StageViewportFrameProps = {
    /**
     * Logical design size the stage + surface content is authored in (the coordinate space).
     * Drives the aspect ratio and, together with {@link outputResolution}, the backing scale.
     */
    designSize: StageViewportSize;
    /**
     * Optional fixed backing resolution the stage rasterizes at before being CSS-upscaled to fit
     * the available area. Must share `designSize`'s aspect ratio (callers enforce this and reject
     * mismatches). `null`/omitted renders natively at the fit size (no clamp, no visual change).
     *
     * Because rendering is pure DOM+CSS, "clarity" is the layout pixel size the browser rasterizes
     * at: laying the whole stage out in a fixed `outputResolution` box and then scaling that box up
     * yields true downsample-to-target (or supersample, when the target exceeds the window).
     */
    outputResolution?: StageViewportSize | null;
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
 * Shared stage frame for every run path (Dev Mode + standalone runtime). Measures its own area,
 * lays the game content out in a `designSize × renderScale` box, and CSS-scales that box to fill
 * the area. Without `outputResolution` the box is the fit size (renderScale = fit, displayScale = 1)
 * — identical to rendering directly into the area. With it, the box is fixed at the target
 * resolution and upscaled, so the stage and every surface inside share one backing clarity.
 */
export function StageViewportFrame(props: StageViewportFrameProps): ReactNode {
    const {
        designSize,
        outputResolution,
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

    const { renderScale, displayScale, backingWidth, backingHeight } = computeStageViewportMetrics({
        area,
        designSize,
        outputResolution,
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
                    transform: `scale(${displayScale})`,
                    transformOrigin: "center",
                    overflow: "hidden",
                    ...boxStyle,
                }}
            >
                {children}
            </div>
        </div>
    );
}
