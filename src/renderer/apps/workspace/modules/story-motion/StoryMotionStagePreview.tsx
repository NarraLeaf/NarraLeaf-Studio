import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { RotateCw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import type { StoryMotionPreviewState } from "./storyMotionTimeline";
import type { StoryMotionPreviewTarget } from "./storyMotionPreviewTarget";
import { SampleStage, SampleSubject } from "@/lib/story/previewSubject";

export type StoryMotionPreviewDragMode = "position" | "zoom" | "rotation" | "scaleX" | "scaleY";

export function StoryMotionStagePreview(props: {
    preview: StoryMotionPreviewState;
    target: StoryMotionPreviewTarget;
    onPointerDrag: (event: ReactPointerEvent<HTMLDivElement>, mode: StoryMotionPreviewDragMode) => void;
    interactive?: boolean;
    stageSize?: { width: number; height: number };
    showLabel?: boolean;
    backgroundUrl?: string | null;
    allowOverflow?: boolean;
    canvasScale?: number;
}) {
    const { t } = useTranslation();
    const { url } = useAssetObjectUrl(props.target.assetId ?? null);
    const interactive = props.interactive ?? true;
    const fixedStage = props.stageSize && props.stageSize.width > 0 && props.stageSize.height > 0;
    const showLabel = props.showLabel ?? true;
    const overflowClass = props.allowOverflow ? "overflow-visible" : "overflow-hidden";
    // Handles sit inside the target frame (scaled by zoom * scale) which itself sits
    // inside the canvas (scaled by canvasScale). Counter both so they stay a constant
    // size on screen no matter how far the canvas or element is scaled.
    const canvasScale = props.canvasScale ?? 1;
    const handleInvX = 1 / Math.max(0.05, Math.abs(canvasScale * props.preview.zoom * props.preview.scaleX));
    const handleInvY = 1 / Math.max(0.05, Math.abs(canvasScale * props.preview.zoom * props.preview.scaleY));
    const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
    useEffect(() => {
        setNaturalSize(null);
    }, [url]);
    const naturalFrame = Boolean(url && naturalSize);
    // NLR sizes an `autoFit` displayable to the full stage width (its configured width),
    // taking only the aspect ratio from the image's intrinsic pixels; a non-autoFit image
    // keeps its natural pixel footprint. Match whichever the bound target uses so the
    // preview scale lines up with the runtime instead of appearing shrunk or blown up.
    // The camera is autoFit by nature: what it moves IS the stage rectangle.
    const isCamera = props.target.kind === "camera";
    const autoFit = props.target.autoFit ?? (props.target.kind === "character" || isCamera);
    const stageWidth = props.stageSize?.width ?? 0;
    const frameSize = useMemo(() => {
        if (!naturalSize) {
            // No image: size the placeholder as a FRACTION OF THE STAGE, not in CSS pixels.
            //
            // It used to be a fixed `h-40 w-32` box, which is a sane sprite footprint at 1:1 and
            // vanishes the moment the preview is scaled: on a 1920×1080 stage drawn into a 148px card
            // it is 10×12px — the preset gallery was a grid of empty squares because of it. A fraction
            // reads the same at every preview size, and is closer to a real portrait's share of the
            // stage than 128px ever was.
            return props.stageSize ? placeholderFrame(props.target.kind, props.stageSize) : null;
        }
        if (autoFit && stageWidth > 0) {
            return { width: stageWidth, height: stageWidth * naturalSize.height / naturalSize.width };
        }
        return naturalSize;
    }, [autoFit, naturalSize, props.stageSize, props.target.kind, stageWidth]);
    // The frame only carries placement (position, rotation, scale) so the control
    // handles inherit it. Opacity and visual effects live on an inner wrapper so the
    // handles are never dimmed, masked or filtered along with the displayable.
    // Vertical placement is anchored from the bottom with a +50% translate to match NLR's
    // default "bottom left" origin (yalign measured up from the bottom, +yoffset moves up).
    const targetStyle = useMemo<CSSProperties>(() => ({
        left: `calc(${props.preview.position.xalign * 100}% + ${props.preview.position.xoffset}px)`,
        bottom: `calc(${props.preview.position.yalign * 100}% + ${props.preview.position.yoffset}px)`,
        transform: `translate(-50%, 50%) rotate(${props.preview.rotation}deg) scale(${props.preview.zoom * props.preview.scaleX}, ${props.preview.zoom * props.preview.scaleY})`,
        ...(frameSize ? { width: frameSize.width, height: frameSize.height } : {}),
    }), [frameSize, props.preview]);
    const contentStyle = useMemo<CSSProperties>(() => ({
        opacity: props.preview.opacity,
        filter: props.preview.effects.filter,
        backdropFilter: props.preview.effects.backdropFilter,
        clipPath: props.preview.effects.clipPath,
        mixBlendMode: props.preview.effects.mixBlendMode as CSSProperties["mixBlendMode"],
        maskImage: props.preview.effects.maskImage,
        maskSize: props.preview.effects.maskSize,
        maskPosition: props.preview.effects.maskPosition,
        maskRepeat: props.preview.effects.maskRepeat,
        maskMode: props.preview.effects.maskMode as CSSProperties["maskMode"],
    }), [props.preview]);

    return (
        <div
            className={`${fixedStage ? "relative shrink-0 rounded-md bg-[#15171b]" : "relative min-h-0 flex-1 bg-[#15171b]"} ${overflowClass}`}
            style={fixedStage ? { width: props.stageSize!.width, height: props.stageSize!.height } : undefined}
        >
            {props.backgroundUrl ? (
                <img
                    src={props.backgroundUrl}
                    alt=""
                    className={`${fixedStage ? "absolute inset-0" : "absolute inset-6"} h-full w-full object-cover ${fixedStage ? "" : "rounded-md"}`}
                    draggable={false}
                />
            ) : null}
            <div className={`${fixedStage ? "absolute inset-0" : "absolute inset-6"} rounded-md border border-white/10 bg-[linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px)] bg-[length:32px_32px]`} />
            {showLabel ? (
                <div className={`${fixedStage ? "left-2 top-2" : "left-6 top-6"} absolute rounded-md border border-white/10 bg-black/30 px-2 py-1 text-2xs text-white/70`}>
                    {t("motion.preview.stageLabel")}
                </div>
            ) : null}
            <div
                className={targetFrameClass(props.target.kind, interactive, naturalFrame, Boolean(url))}
                style={targetStyle}
                onPointerDown={interactive ? event => props.onPointerDrag(event, "position") : undefined}
            >
                <div className="h-full w-full" style={contentStyle}>
                    <PreviewContent
                        target={props.target}
                        url={url}
                        fontColor={props.preview.effects.fontColor}
                        onNaturalSize={setNaturalSize}
                    />
                </div>
                {interactive ? (
                    <>
                        <div
                            className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded-md border border-white/70 bg-primary"
                            style={{ transform: `scale(${handleInvX}, ${handleInvY})`, transformOrigin: "center" }}
                            onPointerDown={event => props.onPointerDrag(event, "zoom")}
                            data-tip={t("motion.preview.dragZoom")}
                        />
                        <div
                            className="absolute -right-2 top-1/2 h-4 w-2.5 cursor-ew-resize rounded-sm border border-white/70 bg-[#1b1d22]"
                            style={{ transform: `translateY(-50%) scale(${handleInvX}, ${handleInvY})`, transformOrigin: "center" }}
                            onPointerDown={event => props.onPointerDrag(event, "scaleX")}
                            data-tip={t("motion.preview.dragScaleX")}
                        />
                        <div
                            className="absolute -bottom-2 left-1/2 h-2.5 w-4 cursor-ns-resize rounded-sm border border-white/70 bg-[#1b1d22]"
                            style={{ transform: `translateX(-50%) scale(${handleInvX}, ${handleInvY})`, transformOrigin: "center" }}
                            onPointerDown={event => props.onPointerDrag(event, "scaleY")}
                            data-tip={t("motion.preview.dragScaleY")}
                        />
                        <div
                            className="absolute -top-7 left-1/2 grid h-5 w-5 cursor-ew-resize place-items-center rounded-full border border-white/50 bg-[#1b1d22] text-white"
                            style={{ transform: `translateX(-50%) scale(${handleInvX}, ${handleInvY})`, transformOrigin: "center" }}
                            onPointerDown={event => props.onPointerDrag(event, "rotation")}
                            data-tip={t("motion.preview.dragRotate")}
                        >
                            <RotateCw className="h-3 w-3" />
                        </div>
                    </>
                ) : null}
            </div>
            {/* The camera transforms the stage as one unit but leaves the dialogue box alone. Drawing
                that box *outside* the moving frame is how the preview states it — and it is also the
                difference an author needs when choosing between `/camera darken` and `/vignette`. */}
            {isCamera ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/5 border-t border-white/15 bg-black/45" />
            ) : null}
        </div>
    );
}

function PreviewContent(props: {
    target: StoryMotionPreviewTarget;
    url: string | null;
    fontColor?: string;
    onNaturalSize: (size: { width: number; height: number }) => void;
}) {
    if (props.url) {
        return (
            <img
                src={props.url}
                alt=""
                className="pointer-events-none h-full w-full select-none"
                draggable={false}
                onLoad={event => {
                    const image = event.currentTarget;
                    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                        props.onNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
                    }
                }}
            />
        );
    }
    if (props.target.kind === "text") {
        return (
            <div
                className="max-w-72 whitespace-pre-wrap px-4 py-3 text-center font-medium leading-tight text-white"
                style={{
                    color: props.fontColor ?? props.target.fontColor ?? "#ffffff",
                    fontSize: Math.max(12, Math.min(48, props.target.fontSize ?? 24)),
                }}
            >
                {props.target.text?.trim() || props.target.label}
            </div>
        );
    }
    if (props.target.kind === "layer") {
        return (
            <div className="grid h-full w-full place-items-center rounded-md border border-dashed border-primary/50 bg-primary/10 px-4 text-xs font-medium text-primary">
                {props.target.label}
            </div>
        );
    }
    if (props.target.kind === "camera") {
        // A stand-in composition, not a decoration: a horizon and one figure are the minimum that
        // makes a pan or a tilt readable at all. With a preview image bound, that image is used
        // instead (the `props.url` branch above), which is the faithful version.
        //
        // Deliberately unlabelled, unlike the layer/image placeholders: those are featureless boxes
        // that need a name, while this one is already a picture of a stage. A caption here also ended
        // up inside every gallery card's accessible name ("CameraShake0.42s / Position").
        return <SampleStage className="rounded-md border border-primary/40" />;
    }
    // An image or a character with nothing bound. It used to be a coloured box with a name in it,
    // which auditions every preset identically: a box does not read as moving, scaling or turning.
    // The stand-in portrait does, and the label stays as the frame's own caption rather than being
    // the only thing in the frame.
    return <SampleSubject />;
}

/**
 * A placeholder's footprint as a share of the stage, so it stays legible at any preview scale.
 * Roughly what each kind actually occupies: a portrait is tall and narrow, a layer is a wide region,
 * a text block is a banner, and the camera IS the stage.
 */
function placeholderFrame(
    kind: StoryMotionPreviewTarget["kind"],
    stage: { width: number; height: number },
): { width: number; height: number } {
    if (kind === "camera") return { width: stage.width, height: stage.height };
    if (kind === "layer") return { width: stage.width * 0.42, height: stage.height * 0.55 };
    if (kind === "text") return { width: stage.width * 0.34, height: stage.height * 0.14 };
    return { width: stage.width * 0.22, height: stage.height * 0.62 };
}

function targetFrameClass(
    kind: StoryMotionPreviewTarget["kind"],
    interactive: boolean,
    naturalFrame: boolean,
    hasImage: boolean,
): string {
    // Every footprint now comes from `frameSize` (natural pixels for an image, a stage fraction for a
    // placeholder), so this function only decides the chrome.
    const base = `absolute select-none ${interactive ? "cursor-move" : "pointer-events-none"}`;
    if (kind === "camera" || naturalFrame || hasImage) {
        return base;
    }
    const boxed = `${base} shadow-[0_12px_40px_rgba(0,0,0,.28)]`;
    if (kind === "text") {
        return `${boxed} rounded-md border border-primary/30 bg-black/20`;
    }
    return `${boxed} rounded-md`;
}
