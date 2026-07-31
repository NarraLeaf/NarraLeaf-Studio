import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { StoryAnimationTimeline } from "@shared/types/story";
import { StoryMotionStagePreview } from "./StoryMotionStagePreview";
import type { StoryMotionPreviewTarget } from "./storyMotionPreviewTarget";
import { getStoryMotionDurationMs, sampleStoryMotionPreview } from "./storyMotionTimeline";

/** The pause between loops. Without it a shake reads as one continuous jitter instead of a move. */
const PREVIEW_LOOP_GAP_MS = 1100;
/** Sampling cadence. 30fps is plenty for a thumbnail and keeps a gallery of them cheap. */
const PREVIEW_FRAME_MS = 1000 / 30;

/**
 * Playhead for a looping motion thumbnail, in milliseconds. Returns 0 while inactive, so a gallery
 * can mount many previews and only pay for the one under the pointer.
 */
export function useStoryMotionLoopTimeMs(durationMs: number, active: boolean, restTimeMs = 0): number {
    const [timeMs, setTimeMs] = useState(restTimeMs);
    useEffect(() => {
        if (!active) {
            setTimeMs(restTimeMs);
            return;
        }
        let frame = 0;
        let startedAt: number | null = null;
        let lastPaint = 0;
        const duration = Math.max(1, durationMs);
        const cycle = duration + PREVIEW_LOOP_GAP_MS;
        const tick = (time: number) => {
            if (startedAt === null) {
                startedAt = time;
            }
            if (lastPaint === 0 || time - lastPaint >= PREVIEW_FRAME_MS) {
                const elapsed = (time - startedAt) % cycle;
                setTimeMs(Math.round(Math.min(elapsed, duration)));
                lastPaint = time;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [active, durationMs, restTimeMs]);
    return timeMs;
}

/**
 * A looping, non-interactive motion thumbnail: the stage preview scaled to fit `box`.
 *
 * Shared by the motion selector's hover preview and the preset gallery's cards, which is the point -
 * a preset and a saved motion are the same kind of thing (a timeline against a target), so an author
 * comparing them must be looking at the same renderer, not at two approximations of it.
 */
export function StoryMotionLoopPreview(props: {
    timeline: StoryAnimationTimeline | undefined;
    target: StoryMotionPreviewTarget;
    stageSize: { width: number; height: number };
    box: { width: number; height: number };
    backgroundUrl?: string | null;
    /** Drives the playhead — false parks the motion at `restTimeMs`. */
    active?: boolean;
    /**
     * Where the playhead sits while inactive. Defaults to 0 (the pose the motion starts from), which
     * is right for a single preview and wrong for a grid: see {@link storyMotionSignatureTimeMs}.
     */
    restTimeMs?: number;
    /** Top-left overlay (the motion's name). */
    caption?: ReactNode;
    /** Bottom-right overlay (duration / animated properties). */
    footer?: ReactNode;
    className?: string;
}) {
    const durationMs = useMemo(() => getStoryMotionDurationMs(props.timeline), [props.timeline]);
    const timeMs = useStoryMotionLoopTimeMs(durationMs, props.active ?? true, props.restTimeMs ?? 0);
    const preview = useMemo(() => sampleStoryMotionPreview(props.timeline, timeMs), [props.timeline, timeMs]);
    const scale = Math.min(props.box.width / props.stageSize.width, props.box.height / props.stageSize.height);

    return (
        <div
            style={{ width: props.box.width, height: props.box.height }}
            className={["relative flex items-center justify-center overflow-hidden", props.className ?? ""].join(" ")}
        >
            <div style={{ width: props.stageSize.width * scale, height: props.stageSize.height * scale }}>
                <div style={{ width: props.stageSize.width, height: props.stageSize.height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                    <StoryMotionStagePreview
                        preview={preview}
                        target={props.target}
                        onPointerDrag={() => undefined}
                        interactive={false}
                        stageSize={props.stageSize}
                        showLabel={false}
                        backgroundUrl={props.backgroundUrl}
                    />
                </div>
            </div>
            {props.caption ? (
                <div className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-black/55 px-1.5 py-0.5 text-2xs font-medium text-white">
                    {props.caption}
                </div>
            ) : null}
            {props.footer ? (
                <div className="absolute bottom-2 right-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-black/55 px-1.5 py-0.5 text-2xs text-white/70">
                    {props.footer}
                </div>
            ) : null}
        </div>
    );
}
