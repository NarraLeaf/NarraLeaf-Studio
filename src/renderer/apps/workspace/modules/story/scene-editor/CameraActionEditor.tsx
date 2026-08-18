import { useCallback, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Moon, Move, Palette, RotateCw, Spline, Undo2, ZoomIn } from "lucide-react";
import type { StoryActionPayload, StoryBlock, StorySceneId, StoryTransformRef } from "@shared/types/story";
import { getPresetPosition } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { Services } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { Slider, type SelectOption } from "@/lib/components/elements";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { MotionField } from "../../story-motion";
import { resolveStoryMotionStageSize } from "../../story-motion/StoryMotionEditorTab";
import {
    getStoryCameraLookPreset,
    resolveStoryCameraLook,
    STORY_CAMERA_LOOK_DEFAULT_PRESET_ID,
    storyCameraLookSways,
    STORY_CAMERA_LOOK_MAX_INTENSITY,
    STORY_CAMERA_LOOK_MIN_INTENSITY,
    STORY_CAMERA_LOOK_PRESETS,
} from "@/lib/ui-editor/runtime/game/cameraLookPresets";
import { FIELD_LABEL_CLASS, FieldGrid, SecondsField, SelectField, Section, TextField, easingOptions } from "./inspectorFieldKit";

type CameraActionPayload = Extract<StoryActionPayload, { action: "camera" }>;
type CameraOperation = CameraActionPayload["operation"];

/** Mirrors the compiler's floor - the inspector must not be able to store a shot the compile then rewrites. */
const MIN_CAMERA_ZOOM = 0.05;

/** Slider ranges. Wider than any usable shot, so the slider never becomes the reason a value is out of reach. */
const ZOOM_RANGE = { min: 0.25, max: 4, step: 0.05 };
const ROTATION_RANGE = { min: -180, max: 180, step: 1 };
const DARKNESS_RANGE = { min: 0, max: 1, step: 0.01 };
const ALIGN_RANGE = { min: 0, max: 1, step: 0.01 };

const OPERATION_ICONS: Record<CameraOperation, typeof ZoomIn> = {
    zoom: ZoomIn,
    pan: Move,
    rotate: RotateCw,
    darken: Moon,
    look: Palette,
    motion: Spline,
    reset: Undo2,
};

// `look` sits directly after `darken` because the two write the SAME channel and an author choosing
// between them should find them side by side rather than discover the collision at runtime.
const OPERATION_ORDER: readonly CameraOperation[] = ["zoom", "pan", "rotate", "darken", "look", "motion", "reset"];

const LOOK_INTENSITY_RANGE = { min: STORY_CAMERA_LOOK_MIN_INTENSITY, max: STORY_CAMERA_LOOK_MAX_INTENSITY, step: 0.05 };

/** The three placements the command line offers, resolved through the one table that owns the mapping. */
const PAN_PLACEMENTS = ["left", "center", "right"] as const;

/**
 * The camera's knobs.
 *
 * What the *shape* of this editor has to carry, because a paragraph of explanation is not the house
 * style:
 *  - the section title says the pose is story-wide, so an author does not expect a scene change to
 *    put the camera back;
 *  - `darken` is labelled as STAGE brightness, which is what tells it apart from `/vignette`'s
 *    in-scene mask layer — and the viewfinder dims the stage rect while leaving the dialogue bar lit,
 *    which is the same statement in a picture;
 *  - `reset` and `motion` sit in the same six-way operation picker as the four poses, because the
 *    camera is one instrument and these are its knobs — not six unrelated commands;
 *  - every pose has a **viewfinder**: `zoom 1.4` and `xalign 0.3` are numbers nobody can picture, and
 *    the frame is the thing the author is actually choosing.
 *
 * Each operation shows only its own value: a `zoom` row carrying a stale `rotation` field would be
 * offering to edit a number the compile never reads. The viewfinder obeys the same rule — it draws the
 * active channel over a neutral pose, so what it shows is exactly what this row will do.
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
    const operation = payload.operation;
    const onChange = props.onChange;

    const projectService = useMemo(
        () => context && isInitialized ? context.services.get<ProjectService>(Services.Project) : null,
        [context, isInitialized],
    );
    const stageSize = useMemo(() => resolveStoryMotionStageSize(projectService), [projectService]);

    const setOperation = useCallback((next: CameraOperation) => {
        // Switching into `motion` seeds the ref in animation mode so the field opens on the motion
        // picker; `look` seeds a grade for the same reason - both are channels whose empty state
        // compiles to nothing, so landing on them with no value would be a row that does not play.
        // The other channels are left alone, since the compile only reads the active one and an
        // author toggling between knobs should not lose the number they just set.
        if (next === "motion" && !payload.motion) {
            onChange({ ...payload, operation: next, motion: { mode: "animation" } });
            return;
        }
        if (next === "look" && !payload.lookPreset && !payload.filter) {
            onChange({ ...withLookPreset(payload, STORY_CAMERA_LOOK_DEFAULT_PRESET_ID), operation: next });
            return;
        }
        onChange({ ...payload, operation: next });
    }, [onChange, payload]);

    const setPan = useCallback((next: { xalign?: number; yalign?: number }) => {
        onChange({
            ...payload,
            position: {
                ...payload.position,
                ...(next.xalign === undefined ? {} : { xalign: clampAlign(next.xalign) }),
                ...(next.yalign === undefined ? {} : { yalign: clampAlign(next.yalign) }),
            },
        });
    }, [onChange, payload]);

    return (
        <Section title={t("storyInspector.section.camera")}>
            <div className="grid grid-cols-1 gap-2">
                {/* Every knob of one instrument, all visible at once. The short label is what fits; the
                    full name (which is where `Darken stage` says *stage*) is the tooltip, and the
                    viewfinder below says the same thing in a picture. */}
                <div className="grid grid-cols-3 gap-1">
                    {OPERATION_ORDER.map(option => {
                        const Icon = OPERATION_ICONS[option];
                        const selected = operation === option;
                        return (
                            <button
                                key={option}
                                type="button"
                                data-tip={t(`storyInspector.cameraOperation.${option}`)}
                                className={[
                                    "flex h-8 min-w-0 items-center justify-center gap-1 rounded-md border px-1 text-2xs transition-colors",
                                    selected
                                        ? "border-primary/50 bg-primary/15 text-primary"
                                        : "border-edge bg-surface text-fg-muted hover:text-fg",
                                ].join(" ")}
                                onClick={() => setOperation(option)}
                            >
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{t(`storyInspector.cameraOperationShort.${option}`)}</span>
                            </button>
                        );
                    })}
                </div>

                {operation === "motion" ? (
                    <MotionField
                        value={payload.motion}
                        targetKind="camera"
                        motionLabel={t("storyInspector.motionTarget.camera")}
                        actionContext={{
                            storyId: props.storyId,
                            sceneId: props.sceneId,
                            blockId: props.blockId,
                            storyName: props.storyName,
                        }}
                        onChange={(motion: StoryTransformRef | undefined) => onChange({ ...payload, motion })}
                    />
                ) : (
                    <>
                        <CameraViewfinder
                            payload={payload}
                            stageSize={stageSize}
                            onPan={operation === "pan" ? setPan : undefined}
                        />
                        {operation === "zoom" ? (
                            <SliderRow
                                label={t("storyInspector.camera.zoom")}
                                range={ZOOM_RANGE}
                                value={payload.zoom ?? 1}
                                neutral={1}
                                onChange={zoom => onChange({ ...payload, zoom: Math.max(MIN_CAMERA_ZOOM, zoom) })}
                            />
                        ) : null}
                        {operation === "rotate" ? (
                            <SliderRow
                                label={t("storyInspector.camera.rotation")}
                                range={ROTATION_RANGE}
                                value={payload.rotation ?? 0}
                                neutral={0}
                                onChange={rotation => onChange({ ...payload, rotation })}
                            />
                        ) : null}
                        {operation === "darken" ? (
                            <SliderRow
                                label={t("storyInspector.camera.darkness")}
                                range={DARKNESS_RANGE}
                                value={payload.darkness ?? 0}
                                neutral={0}
                                onChange={darkness => onChange({ ...payload, darkness: clampAlign(darkness) })}
                            />
                        ) : null}
                        {operation === "look" ? (
                            <div className="grid grid-cols-1 gap-2">
                                <FieldGrid cols={2}>
                                    <SelectField
                                        label={t("storyInspector.camera.look")}
                                        options={lookPresetOptions(t)}
                                        value={payload.lookPreset ?? ""}
                                        onChange={next => onChange(withLookPreset(payload, String(next) || undefined))}
                                    />
                                    <SliderRow
                                        label={t("storyInspector.camera.lookIntensity")}
                                        range={LOOK_INTENSITY_RANGE}
                                        value={payload.lookIntensity ?? 1}
                                        neutral={1}
                                        onChange={lookIntensity => onChange({ ...payload, lookIntensity: clampIntensity(lookIntensity) })}
                                    />
                                </FieldGrid>
                                {/* The escape hatch, and it says so by showing the grade it would
                                    replace as its placeholder: an author who only wanted to nudge one
                                    term can copy the resolved string rather than write CSS from
                                    nothing, and one who types here can see they have taken over. */}
                                <TextField
                                    label={t("storyInspector.camera.lookFilter")}
                                    value={payload.filter ?? ""}
                                    placeholder={resolveStoryCameraLook(payload.lookPreset, payload.lookIntensity) ?? ""}
                                    onChange={next => onChange({ ...payload, filter: next.trim() ? next : undefined })}
                                />
                                {/* Not decoration: the two operations are one channel in the engine,
                                    so a scene that sets both plays whichever came second and loses
                                    the other outright. Said here because there is nowhere else an
                                    author would find it out before shipping. */}
                                <p className="text-2xs text-fg-subtle">{t("storyInspector.cameraLookHint.channel")}</p>
                                {payload.lookPreset === "monologue" ? (
                                    <p className="text-2xs text-fg-subtle">{t("storyInspector.cameraLookHint.monologue")}</p>
                                ) : null}
                                {/* The one grade that does not settle immediately, so it is the one
                                    whose row costs time. An author choosing it from a list of still
                                    looks has no other way to know that. */}
                                {payload.lookPreset === "hangover" ? (
                                    <p className="text-2xs text-fg-subtle">{t("storyInspector.cameraLookHint.hangover")}</p>
                                ) : null}
                            </div>
                        ) : null}
                        {operation === "pan" ? (
                            <div className="grid grid-cols-1 gap-2">
                                <div className="flex gap-1">
                                    {PAN_PLACEMENTS.map(placement => {
                                        const xalign = getPresetPosition(placement, {})?.xalign ?? 0.5;
                                        const active = (payload.position?.xalign ?? 0.5) === xalign;
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
                                                onClick={() => setPan({ xalign, yalign: 0.5 })}
                                            >
                                                {t(`story.position.${placement}`)}
                                            </button>
                                        );
                                    })}
                                </div>
                                <FieldGrid cols={2}>
                                    <SliderRow
                                        label={t("storyInspector.camera.xalign")}
                                        range={ALIGN_RANGE}
                                        value={payload.position?.xalign ?? 0.5}
                                        neutral={0.5}
                                        onChange={xalign => setPan({ xalign })}
                                    />
                                    <SliderRow
                                        label={t("storyInspector.camera.yalign")}
                                        range={ALIGN_RANGE}
                                        value={payload.position?.yalign ?? 0.5}
                                        neutral={0.5}
                                        onChange={yalign => setPan({ yalign })}
                                    />
                                </FieldGrid>
                            </div>
                        ) : null}
                        {/* A grade lands in one frame, so it has no timing to offer — see the
                            compiler's `look` arm for why interpolating one is not an option. The
                            fields are hidden rather than disabled: a control that is present but
                            never does anything is the thing an author wastes time on. */}
                        {operation === "look" && !storyCameraLookSways(payload.lookPreset) ? (
                            <p className="text-2xs text-fg-subtle">{t("storyInspector.camera.lookSnaps")}</p>
                        ) : (
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
                        )}
                    </>
                )}
            </div>
        </Section>
    );
}

/**
 * The shot, drawn.
 *
 * The stage is a rectangle that the camera moves and scales as one unit — exactly what the engine
 * does, since `Camera` is a `Displayable` and `camera.pan` is an alias of `Displayable.pos`. So the
 * widget is a fixed viewport with the stage rect inside it, using the same align→CSS mapping as the
 * Story Motion preview (`left: xalign%`, `bottom: yalign%`, centred by a −50%/+50% translate). One
 * mental model across both surfaces; and dragging behaves the way the runtime will.
 *
 * The dialogue bar is drawn OUTSIDE the stage rect because the camera never moves it. That is the
 * difference between `/camera darken` and `/vignette`, said in a picture instead of a sentence.
 */
function CameraViewfinder(props: {
    payload: CameraActionPayload;
    stageSize: { width: number; height: number };
    /** Provided only for `pan`; without it the widget is a read-only preview of the active channel. */
    onPan?: (next: { xalign: number; yalign: number }) => void;
}) {
    const { t } = useTranslation();
    const boxRef = useRef<HTMLDivElement | null>(null);
    const payload = props.payload;
    const operation = payload.operation;

    // Only the active channel is drawn — see the comment on this component for why a combined pose
    // would lie about what the row does.
    const zoom = operation === "zoom" ? Math.max(MIN_CAMERA_ZOOM, payload.zoom ?? 1) : 1;
    const rotation = operation === "rotate" ? payload.rotation ?? 0 : 0;
    const darkness = operation === "darken" ? clampAlign(payload.darkness ?? 0) : 0;
    // The grade, drawn on the same rect the runtime grades — which also makes the viewfinder the
    // check on a hand-written filter: CSS the browser cannot parse is dropped whole, so a bad
    // declaration shows here as a stage that did not change, exactly as it would in the game.
    const look = operation === "look"
        ? payload.filter?.trim() || resolveStoryCameraLook(payload.lookPreset, payload.lookIntensity) || undefined
        : undefined;
    const xalign = operation === "pan" ? clampAlign(payload.position?.xalign ?? 0.5) : 0.5;
    const yalign = operation === "pan" ? clampAlign(payload.position?.yalign ?? 0.5) : 0.5;

    const dragTo = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const box = boxRef.current;
        if (!box || !props.onPan) {
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
            className={[
                "relative w-full overflow-hidden rounded-md border border-edge bg-[#15171b]",
                props.onPan ? "cursor-crosshair" : "",
            ].join(" ")}
            style={{ aspectRatio: `${props.stageSize.width} / ${props.stageSize.height}` }}
            onPointerDown={props.onPan ? event => {
                event.currentTarget.setPointerCapture(event.pointerId);
                dragTo(event);
            } : undefined}
            onPointerMove={props.onPan ? event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    dragTo(event);
                }
            } : undefined}
        >
            <div
                className="pointer-events-none absolute h-full w-full border border-primary/40 bg-[linear-gradient(180deg,#2b3550_0%,#3d4a63_58%,#4b4136_58%,#3a3229_100%)]"
                style={{
                    left: `${xalign * 100}%`,
                    bottom: `${yalign * 100}%`,
                    transform: `translate(-50%, 50%) rotate(${rotation}deg) scale(${zoom})`,
                    filter: look ?? (darkness > 0 ? `brightness(${1 - darkness})` : undefined),
                }}
            >
                <div className="absolute bottom-[8%] left-1/2 h-[38%] w-[12%] -translate-x-1/2 rounded-t-full bg-white/25" />
            </div>
            {/* Fixed by the camera, so fixed here. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/5 border-t border-white/15 bg-black/45" />
            <div className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-black/45 px-1 py-0.5 text-2xs text-white/70">
                {t(`storyInspector.cameraOperationShort.${operation}`)}
            </div>
        </div>
    );
}

/**
 * A slider and its exact value, side by side: the slider is for feel, the box is for a value you can
 * name. No third formatted readout — every one of these fields carries its unit in its own label
 * ("Zoom (1 = neutral)", "Rotation °", "X align (0-1)"), so a trailing `×1.8` beside a box already
 * reading `1.8` was the same number printed twice.
 */
function SliderRow(props: {
    label: string;
    range: { min: number; max: number; step: number };
    value: number;
    /** What an emptied box means — the channel's neutral, never a guess from the range. */
    neutral: number;
    onChange: (value: number) => void;
}) {
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <div className="flex items-center gap-2">
                <Slider
                    className="min-w-0 flex-1"
                    min={props.range.min}
                    max={props.range.max}
                    step={props.range.step}
                    value={props.value}
                    onValueChange={props.onChange}
                />
                <div className="w-16 shrink-0">
                    <NumericDraftEnhancedInput
                        committedDisplay={String(round(props.value, 2))}
                        onFiniteNumber={props.onChange}
                        onEmpty={() => props.onChange(props.neutral)}
                        type="text"
                        inputMode="decimal"
                    />
                </div>
            </div>
        </div>
    );
}

/** The grade library as a picker. Every preset is named, never its id — the id is stored, not shown. */
/**
 * Move a row onto a look, carrying the grade's own tempo with it.
 *
 * The timing follows the preset only while the author has not set one of their own: a duration still
 * sitting on the previous preset's default was never a choice, and leaving it behind is how `mono`
 * ends up crawling at `faint`'s two seconds. A number the author typed is theirs and is left alone —
 * so this reads the OLD preset to decide, not the new one.
 */
function withLookPreset(payload: CameraActionPayload, nextId: string | undefined): CameraActionPayload {
    const next = nextId ? getStoryCameraLookPreset(nextId) : undefined;
    const previous = getStoryCameraLookPreset(payload.lookPreset);
    const untouched = payload.durationMs === undefined || payload.durationMs === previous?.defaultDurationMs;
    return {
        ...payload,
        lookPreset: nextId,
        lookIntensity: payload.lookIntensity ?? 1,
        // Only a grade that MOVES gets its tempo seeded. A still grade lands in one frame and the
        // compile reads no duration for it, so writing one onto the row would put a number in the
        // document that nothing downstream honours.
        ...(next?.oscillate && untouched
            ? { durationMs: next.defaultDurationMs, easing: next.defaultEasing }
            : {}),
    };
}

function lookPresetOptions(t: ReturnType<typeof useTranslation>["t"]): SelectOption[] {
    return STORY_CAMERA_LOOK_PRESETS.map(preset => ({
        value: preset.id,
        label: t(`storyInspector.cameraLook.${preset.id}`),
    }));
}

/** Mirrors the library's own range, so the inspector cannot store a grade the compile then rewrites. */
function clampIntensity(value: number): number {
    return Math.min(STORY_CAMERA_LOOK_MAX_INTENSITY, Math.max(STORY_CAMERA_LOOK_MIN_INTENSITY, value));
}

/** An align is a 0–1 fraction of the stage; outside that the camera is aimed off the world. */
function clampAlign(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
