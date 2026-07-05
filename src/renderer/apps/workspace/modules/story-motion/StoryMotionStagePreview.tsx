import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { RotateCw } from "lucide-react";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import type { StoryMotionPreviewState } from "./storyMotionTimeline";
import type { StoryMotionPreviewTarget } from "./storyMotionPreviewTarget";

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
    // NLR renders displayables at their natural resolution when zoom is 1, so the
    // preview frame must adopt the image's intrinsic size instead of a fixed box.
    const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
    useEffect(() => {
        setNaturalSize(null);
    }, [url]);
    const naturalFrame = Boolean(url && naturalSize);
    const targetStyle = useMemo<CSSProperties>(() => ({
        left: `calc(${props.preview.position.xalign * 100}% + ${props.preview.position.xoffset}px)`,
        top: `calc(${props.preview.position.yalign * 100}% + ${props.preview.position.yoffset}px)`,
        opacity: props.preview.opacity,
        transform: `translate(-50%, -50%) rotate(${props.preview.rotation}deg) scale(${props.preview.zoom * props.preview.scaleX}, ${props.preview.zoom * props.preview.scaleY})`,
        ...(naturalFrame ? { width: naturalSize!.width, height: naturalSize!.height } : {}),
        filter: props.preview.effects.filter,
        backdropFilter: props.preview.effects.backdropFilter,
        clipPath: props.preview.effects.clipPath,
        mixBlendMode: props.preview.effects.mixBlendMode as CSSProperties["mixBlendMode"],
        maskImage: props.preview.effects.maskImage,
        maskSize: props.preview.effects.maskSize,
        maskPosition: props.preview.effects.maskPosition,
        maskRepeat: props.preview.effects.maskRepeat,
        maskMode: props.preview.effects.maskMode as CSSProperties["maskMode"],
    }), [naturalFrame, naturalSize, props.preview]);

    return (
        <div
            className={`${fixedStage ? "relative shrink-0 rounded bg-[#15171b]" : "relative min-h-0 flex-1 bg-[#15171b]"} ${overflowClass}`}
            style={fixedStage ? { width: props.stageSize!.width, height: props.stageSize!.height } : undefined}
        >
            {props.backgroundUrl ? (
                <img
                    src={props.backgroundUrl}
                    alt=""
                    className={`${fixedStage ? "absolute inset-0" : "absolute inset-6"} h-full w-full object-cover ${fixedStage ? "" : "rounded"}`}
                    draggable={false}
                />
            ) : null}
            <div className={`${fixedStage ? "absolute inset-0" : "absolute inset-6"} rounded border border-white/10 bg-[linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px)] bg-[length:32px_32px]`} />
            {showLabel ? (
                <div className={`${fixedStage ? "left-2 top-2" : "left-6 top-6"} absolute rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-400`}>
                    Stage preview
                </div>
            ) : null}
            <div
                className={targetFrameClass(props.target.kind, interactive, naturalFrame, Boolean(url))}
                style={targetStyle}
                onPointerDown={interactive ? event => props.onPointerDrag(event, "position") : undefined}
            >
                <PreviewContent
                    target={props.target}
                    url={url}
                    fontColor={props.preview.effects.fontColor}
                    onNaturalSize={setNaturalSize}
                />
                {interactive ? (
                    <>
                        <div
                            className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded border border-white/70 bg-primary"
                            style={{ transform: `scale(${handleInvX}, ${handleInvY})`, transformOrigin: "center" }}
                            onPointerDown={event => props.onPointerDrag(event, "zoom")}
                            title="Drag to zoom"
                        />
                        <div
                            className="absolute -right-2 top-1/2 h-4 w-2.5 cursor-ew-resize rounded-sm border border-white/70 bg-[#1b1d22]"
                            style={{ transform: `translateY(-50%) scale(${handleInvX}, ${handleInvY})`, transformOrigin: "center" }}
                            onPointerDown={event => props.onPointerDrag(event, "scaleX")}
                            title="Drag to scale X"
                        />
                        <div
                            className="absolute -bottom-2 left-1/2 h-2.5 w-4 cursor-ns-resize rounded-sm border border-white/70 bg-[#1b1d22]"
                            style={{ transform: `translateX(-50%) scale(${handleInvX}, ${handleInvY})`, transformOrigin: "center" }}
                            onPointerDown={event => props.onPointerDrag(event, "scaleY")}
                            title="Drag to scale Y"
                        />
                        <div
                            className="absolute -top-7 left-1/2 grid h-5 w-5 cursor-ew-resize place-items-center rounded-full border border-white/50 bg-[#1b1d22] text-slate-200"
                            style={{ transform: `translateX(-50%) scale(${handleInvX}, ${handleInvY})`, transformOrigin: "center" }}
                            onPointerDown={event => props.onPointerDrag(event, "rotation")}
                            title="Drag to rotate"
                        >
                            <RotateCw className="h-3 w-3" />
                        </div>
                    </>
                ) : null}
            </div>
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
            <div className="grid h-full w-full place-items-center rounded border border-dashed border-primary/50 bg-primary/10 px-4 text-xs font-medium text-primary">
                {props.target.label}
            </div>
        );
    }
    return (
        <div className="grid h-full w-full place-items-center rounded border border-primary/40 bg-primary/15 px-3 text-xs font-medium text-primary">
            {props.target.label}
        </div>
    );
}

function targetFrameClass(
    kind: StoryMotionPreviewTarget["kind"],
    interactive: boolean,
    naturalFrame: boolean,
    hasImage: boolean,
): string {
    const base = `absolute select-none ${interactive ? "cursor-move" : "pointer-events-none"}`;
    if (naturalFrame) {
        return base;
    }
    if (hasImage) {
        // Image is loading; keep the placeholder footprint until the natural size is known.
        return `${base} h-40 w-32`;
    }
    const boxed = `${base} shadow-[0_12px_40px_rgba(0,0,0,.28)]`;
    if (kind === "text") {
        return `${boxed} min-h-12 min-w-32 max-w-80 rounded border border-primary/30 bg-black/20`;
    }
    if (kind === "layer") {
        return `${boxed} h-40 w-56 rounded`;
    }
    return `${boxed} h-40 w-32 rounded`;
}
