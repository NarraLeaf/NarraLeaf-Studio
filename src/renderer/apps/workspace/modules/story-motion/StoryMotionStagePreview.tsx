import { useMemo } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { RotateCw } from "lucide-react";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import type { StoryMotionPreviewState } from "./storyMotionTimeline";
import type { StoryMotionPreviewTarget } from "./storyMotionPreviewTarget";

export function StoryMotionStagePreview(props: {
    preview: StoryMotionPreviewState;
    target: StoryMotionPreviewTarget;
    onPointerDrag: (event: ReactPointerEvent<HTMLDivElement>, mode: "position" | "zoom" | "rotation") => void;
    interactive?: boolean;
    stageSize?: { width: number; height: number };
    showLabel?: boolean;
}) {
    const { url } = useAssetObjectUrl(props.target.assetId ?? null);
    const interactive = props.interactive ?? true;
    const fixedStage = props.stageSize && props.stageSize.width > 0 && props.stageSize.height > 0;
    const showLabel = props.showLabel ?? true;
    const targetStyle = useMemo<CSSProperties>(() => ({
        left: `calc(${props.preview.position.xalign * 100}% + ${props.preview.position.xoffset}px)`,
        top: `calc(${props.preview.position.yalign * 100}% + ${props.preview.position.yoffset}px)`,
        opacity: props.preview.opacity,
        transform: `translate(-50%, -50%) rotate(${props.preview.rotation}deg) scale(${props.preview.zoom * props.preview.scaleX}, ${props.preview.zoom * props.preview.scaleY})`,
    }), [props.preview]);

    return (
        <div
            className={fixedStage ? "relative shrink-0 overflow-hidden rounded bg-[#15171b]" : "relative min-h-0 flex-1 overflow-hidden bg-[#15171b]"}
            style={fixedStage ? { width: props.stageSize!.width, height: props.stageSize!.height } : undefined}
        >
            <div className={`${fixedStage ? "absolute inset-0" : "absolute inset-6"} rounded border border-white/10 bg-[linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px)] bg-[length:32px_32px]`} />
            {showLabel ? (
                <div className={`${fixedStage ? "left-2 top-2" : "left-6 top-6"} absolute rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-400`}>
                    Stage preview
                </div>
            ) : null}
            <div
                className={targetFrameClass(props.target.kind, interactive)}
                style={targetStyle}
                onPointerDown={interactive ? event => props.onPointerDrag(event, "position") : undefined}
            >
                <PreviewContent target={props.target} url={url} />
                {interactive ? (
                    <>
                        <div
                            className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded border border-white/70 bg-primary"
                            onPointerDown={event => props.onPointerDrag(event, "zoom")}
                            title="Drag to scale"
                        />
                        <div
                            className="absolute -top-7 left-1/2 grid h-5 w-5 -translate-x-1/2 cursor-ew-resize place-items-center rounded-full border border-white/50 bg-[#1b1d22] text-slate-200"
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

function PreviewContent(props: { target: StoryMotionPreviewTarget; url: string | null }) {
    if (props.url) {
        return <img src={props.url} alt="" className="h-full w-full object-contain" draggable={false} />;
    }
    if (props.target.kind === "text") {
        return (
            <div
                className="max-w-72 whitespace-pre-wrap px-4 py-3 text-center font-medium leading-tight text-white"
                style={{
                    color: props.target.fontColor ?? "#ffffff",
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

function targetFrameClass(kind: StoryMotionPreviewTarget["kind"], interactive: boolean): string {
    const base = `absolute select-none shadow-[0_12px_40px_rgba(0,0,0,.28)] ${interactive ? "cursor-move" : "pointer-events-none"}`;
    if (kind === "text") {
        return `${base} min-h-12 min-w-32 max-w-80 rounded border border-primary/30 bg-black/20`;
    }
    if (kind === "layer") {
        return `${base} h-40 w-56 rounded`;
    }
    return `${base} h-40 w-32 rounded`;
}
