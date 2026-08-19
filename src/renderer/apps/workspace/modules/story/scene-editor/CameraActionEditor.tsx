import { useCallback, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { StoryActionPayload, StoryBlock, StorySceneId, StoryTransformRef } from "@shared/types/story";
import { foldStoryTransformLook, storyTransformPropsToNlr } from "@shared/story/transformProps";
import { getPresetPosition } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { resolveStoryCameraLook } from "@/lib/ui-editor/runtime/game/cameraLookPresets";
import { Services } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { MotionField } from "../../story-motion";
import { resolveStoryMotionStageSize } from "../../story-motion/StoryMotionEditorTab";
import { TransformChannelEditor } from "./TransformChannelEditor";
import { SampleStage } from "@/lib/story/previewSubject";
import { FieldGrid, SecondsField, SegToggle, SelectField, Section, easingOptions } from "./inspectorFieldKit";

type CameraActionPayload = Extract<StoryActionPayload, { action: "camera" }>;

/** Mirrors the compiler's floor - the inspector must not be able to store a shot the compile then rewrites. */
const MIN_CAMERA_ZOOM = 0.05;

/** The three placements the command line offers, resolved through the one table that owns the mapping. */
const PAN_PLACEMENTS = ["left", "center", "right"] as const;

/** Which of the three things a camera row can be. `reset` is a different engine call, not a bag. */
type CameraMode = "pose" | "motion" | "reset";

function modeOf(payload: CameraActionPayload): CameraMode {
    if (payload.operation === "reset") {
        return "reset";
    }
    return payload.transform?.mode === "animation" ? "motion" : "pose";
}

/**
 * The camera's panel.
 *
 * **It is the transform panel, plus a viewfinder.** There used to be a six-way operation picker here,
 * because the payload spelled its state as one operation plus that operation's own field - so the
 * panel had to ask which one the row was, and every other channel disappeared behind the answer. v19
 * gave the camera the same prop bag every other subject writes, so the question no longer has to be
 * asked: the channel list below states as many channels as the row does, and it is the same list a
 * `/transform hero` row opens.
 *
 * What stays camera-shaped is the viewfinder. `zoom 1.4` and `xalign 0.3` are numbers nobody can
 * picture, and the frame is the thing the author is actually choosing - so the widget draws the stage
 * rect the way the engine will, and the dialogue bar sits OUTSIDE it because the camera never moves
 * that. Dragging inside it writes the position channel.
 */
export function CameraActionEditor(props: {
    payload: CameraActionPayload;
    storyId: string;
    sceneId: StorySceneId;
    blockId: string;
    storyName: string;
    onChange: (payload: StoryBlock["payload"]) => void;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const payload = props.payload;
    const onChange = props.onChange;
    const mode = modeOf(payload);
    const transform: StoryTransformRef = payload.transform ?? { mode: "props" };

    const projectService = useMemo(
        () => context && isInitialized ? context.services.get<ProjectService>(Services.Project) : null,
        [context, isInitialized],
    );
    const stageSize = useMemo(() => resolveStoryMotionStageSize(projectService), [projectService]);

    const setMode = useCallback((next: CameraMode) => {
        if (next === "reset") {
            // The pose is dropped rather than kept aside: `reset` states no bag, and a ref parked on a
            // payload nothing reads would come back the next time somebody switched modes and quietly
            // re-apply a shot the author had abandoned.
            onChange({ action: "camera", operation: "reset", ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}) });
            return;
        }
        onChange({
            action: "camera",
            operation: "transform",
            transform: next === "motion"
                ? { ...transform, mode: "animation" }
                : { ...transform, mode: "props", animationId: undefined },
        });
    }, [onChange, payload.durationMs, transform]);

    const setTransform = useCallback((next: StoryTransformRef | undefined) => {
        onChange({ action: "camera", operation: "transform", transform: next ?? { mode: "props" } });
    }, [onChange]);

    const setPan = useCallback((next: { xalign: number; yalign: number }) => {
        const to = transform.to ?? {};
        setTransform({
            ...transform,
            mode: "props",
            to: { ...to, position: { ...to.position, xalign: clampAlign(next.xalign), yalign: clampAlign(next.yalign) } },
        });
    }, [setTransform, transform]);

    return (
        <Section
            title={t("storyInspector.section.camera")}
            right={
                <SegToggle
                    value={mode}
                    options={[
                        { value: "pose", label: t("storyInspector.transform.presetMode") },
                        { value: "motion", label: t("storyInspector.transform.motionMode") },
                        { value: "reset", label: t("storyInspector.cameraOperation.reset") },
                    ]}
                    onChange={next => setMode(next as CameraMode)}
                />
            }
        >
            {mode === "motion" ? (
                <MotionField
                    value={payload.transform}
                    targetKind="camera"
                    motionLabel={t("storyInspector.motionTarget.camera")}
                    actionContext={{
                        storyId: props.storyId,
                        sceneId: props.sceneId,
                        blockId: props.blockId,
                        storyName: props.storyName,
                    }}
                    onChange={setTransform}
                />
            ) : mode === "reset" ? (
                <div className="grid grid-cols-1 gap-2">
                    <p className="text-2xs text-fg-subtle">{t("storyInspector.cameraResetHint")}</p>
                    <FieldGrid cols={2}>
                        <SecondsField
                            label={t("storyInspector.field.duration")}
                            value={payload.durationMs}
                            onChange={durationMs => onChange({ ...payload, durationMs: durationMs === undefined ? undefined : Math.max(0, durationMs) })}
                        />
                        <SelectField
                            label={t("storyInspector.field.easing")}
                            options={easingOptions(t)}
                            value={payload.easing ?? ""}
                            onChange={easing => onChange({ ...payload, easing: String(easing) || undefined })}
                        />
                    </FieldGrid>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-2">
                    <CameraViewfinder transform={transform} stageSize={stageSize} onPan={setPan} />
                    <div className="flex gap-1">
                        {PAN_PLACEMENTS.map(placement => {
                            const xalign = getPresetPosition(placement, {})?.xalign ?? 0.5;
                            const active = transform.to?.position !== undefined && (transform.to.position.xalign ?? 0.5) === xalign;
                            return (
                                <button
                                    key={placement}
                                    type="button"
                                    className={[
                                        "h-7 flex-1 rounded-md border text-2xs transition-colors",
                                        active
                                            ? "border-primary/50 bg-primary/15 text-primary"
                                            : "border-edge bg-surface text-fg-muted hover:text-fg",
                                    ].join(" ")}
                                    onClick={() => setPan({ xalign, yalign: transform.to?.position?.yalign ?? 0.5 })}
                                >
                                    {t(`story.position.${placement}`)}
                                </button>
                            );
                        })}
                    </div>
                    <FieldGrid cols={2}>
                        <SecondsField
                            label={t("storyInspector.field.duration")}
                            value={transform.durationMs}
                            onChange={durationMs => setTransform({ ...transform, durationMs })}
                        />
                        <SelectField
                            label={t("storyInspector.field.easing")}
                            options={easingOptions(t)}
                            value={transform.easing ?? ""}
                            onChange={easing => setTransform({ ...transform, easing: String(easing) || undefined })}
                        />
                    </FieldGrid>
                    <TransformChannelEditor value={payload.transform} targetKind="camera" onChange={setTransform} />
                </div>
            )}
        </Section>
    );
}

/**
 * The shot, drawn.
 *
 * The stage is a rectangle that the camera moves and scales as one unit - exactly what the engine
 * does, since `Camera` is a `Displayable` and `camera.pan` is an alias of `Displayable.pos`. So the
 * widget is a fixed viewport with the stage rect inside it, using the same align->CSS mapping as the
 * Story Motion preview (`left: xalign%`, `bottom: yalign%`, centred by a -50%/+50% translate). One
 * mental model across both surfaces; and dragging behaves the way the runtime will.
 *
 * **Every stated channel is drawn at once**, which it could not be before v19: a row states a bag
 * now, so a combined pose is what the row does rather than a composite of things it does not.
 *
 * The dialogue bar is drawn OUTSIDE the stage rect because the camera never moves it. That is what
 * tells a stage grade apart from a full-screen overlay, said in a picture instead of a sentence.
 */
function CameraViewfinder(props: {
    transform: StoryTransformRef;
    stageSize: { width: number; height: number };
    onPan: (next: { xalign: number; yalign: number }) => void;
}) {
    const boxRef = useRef<HTMLDivElement | null>(null);
    const to = props.transform.mode === "animation" ? undefined : props.transform.to;
    // Through the same fold the compile uses, so a grade previews as the CSS that will play - which
    // also makes this the check on a hand-written chain: CSS the browser cannot parse is dropped
    // whole, and shows here as a stage that did not change.
    const nlr = storyTransformPropsToNlr(foldStoryTransformLook(to, resolveStoryCameraLook));
    const zoom = Math.max(MIN_CAMERA_ZOOM, typeof nlr.zoom === "number" ? nlr.zoom : 1);
    const rotation = typeof nlr.rotation === "number" ? nlr.rotation : 0;
    const filter = typeof nlr.filter === "string" ? nlr.filter : undefined;
    const xalign = clampAlign(to?.position?.xalign ?? 0.5);
    const yalign = clampAlign(to?.position?.yalign ?? 0.5);
    // The lens sits OUTSIDE the camera's transform in the engine - its overlay is a sibling of the
    // transform node - so the shutter and the vignette are drawn over the viewport, not over the
    // stage rect. That is the whole reason they are camera props instead of a stage object.
    const shutter = clampAlign(typeof to?.shutter === "number" ? to.shutter : 0);
    const vignette = clampAlign(typeof to?.vignette === "number" ? to.vignette : 0);

    const dragTo = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const box = boxRef.current;
        if (!box) {
            return;
        }
        const rect = box.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }
        props.onPan({
            xalign: clampAlign((event.clientX - rect.left) / rect.width),
            // yalign is measured up from the bottom, matching NLR's origin.
            yalign: clampAlign(1 - (event.clientY - rect.top) / rect.height),
        });
    }, [props]);

    return (
        <div
            ref={boxRef}
            className="relative w-full cursor-crosshair overflow-hidden rounded-md border border-edge bg-[#15171b]"
            style={{ aspectRatio: `${props.stageSize.width} / ${props.stageSize.height}` }}
            onPointerDown={event => {
                event.currentTarget.setPointerCapture(event.pointerId);
                dragTo(event);
            }}
            onPointerMove={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    dragTo(event);
                }
            }}
        >
            <div
                className="pointer-events-none absolute h-full w-full border border-primary/40"
                style={{
                    left: `${xalign * 100}%`,
                    bottom: `${yalign * 100}%`,
                    transform: `translate(-50%, 50%) rotate(${rotation}deg) scale(${zoom})`,
                    filter,
                }}
            >
                <SampleStage />
            </div>
            {vignette > 0 ? (
                <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                        background: `radial-gradient(ellipse at center, transparent ${to?.vignetteInner ?? "44%"}, ${to?.vignetteColor ?? "#000"} ${to?.vignetteOuter ?? "78%"})`,
                        opacity: vignette,
                    }}
                />
            ) : null}
            {shutter > 0 ? (
                <>
                    <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: `${shutter * 50}%`, background: to?.shutterColor ?? "#000" }} />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: `${shutter * 50}%`, background: to?.shutterColor ?? "#000" }} />
                </>
            ) : null}
            {/* Fixed by the camera, so fixed here. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/5 border-t border-white/15 bg-black/45" />
        </div>
    );
}

/** An align is a 0-1 fraction of the stage; outside that the camera is aimed off the world. */
function clampAlign(value: number): number {
    return Math.min(1, Math.max(0, value));
}
