import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Trash2 } from "lucide-react";
import { formatStoryBezierEasing, parseStoryEasing } from "@shared/utils/storyEasing";
import type {
    StoryAlignPositionValue,
    StoryAnimationAsset,
    StoryAnimationKeyframe,
    StoryAnimationKeyframeValue,
    StoryAnimationTrack,
} from "@shared/types/story";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { PropertyEditor, createPropertyEditorSchema, defineField } from "../properties/framework";
import type { FieldDefinition, PropertyEditorSchema } from "../properties/framework/types";
import {
    SurfaceEditorToolbarButtonGroup,
    SurfaceEditorToolbarSegButton,
} from "../ui-editor/editors/SurfaceEditorToolbarButtonGroup";
import {
    STORY_MOTION_EASING_OPTIONS,
    STORY_MOTION_MAX_DURATION_MS,
    clampStoryMotionTimeMs,
    deleteStoryMotionKeyframe,
    formatStoryMotionTime,
    getStoryMotionPropertyMeta,
    getStoryMotionTimeline,
    isStoryMotionBezierEasing,
    updateStoryMotionKeyframe,
} from "./storyMotionTimeline";

const CUSTOM_EASING_OPTION = "__custom";
const DEFAULT_CUSTOM_BEZIER = "cubic-bezier(0.42, 0, 0.58, 1)";
import {
    STORY_MOTION_KEYFRAME_SELECTION_TYPE,
    isStoryMotionKeyframeSelectionData,
    type StoryMotionKeyframeSelection,
} from "./storyMotionTypes";

type StoryMotionKeyframeInspectorData = {
    asset: StoryAnimationAsset;
    track: StoryAnimationTrack;
    keyframe: StoryAnimationKeyframe;
};

export function StoryMotionKeyframeProperties(props: {
    selection: StoryMotionKeyframeSelection;
    storyService: StoryService;
    uiService: UIService;
}) {
    const { selection, storyService, uiService } = props;
    const [asset, setAsset] = useState<StoryAnimationAsset | null>(null);

    const clearSelection = useCallback(() => {
        clearStoryMotionKeyframeSelection(uiService, selection);
    }, [selection, uiService]);

    const loadSelectedAsset = useCallback(() => {
        let disposed = false;
        void storyService.loadAnimationAsset(selection.animationId)
            .then(next => {
                if (!disposed) {
                    setAsset(next);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setAsset(null);
                    clearSelection();
                }
            });
        return () => {
            disposed = true;
        };
    }, [clearSelection, selection.animationId, storyService]);

    useEffect(() => loadSelectedAsset(), [loadSelectedAsset]);

    useEffect(() => {
        return storyService.onAnimationsChanged(index => {
            if (!index.animations.some(item => item.id === selection.animationId)) {
                setAsset(null);
                clearSelection();
                return;
            }
            void storyService.loadAnimationAsset(selection.animationId)
                .then(setAsset)
                .catch(() => {
                    setAsset(null);
                    clearSelection();
                });
        });
    }, [clearSelection, selection.animationId, storyService]);

    const selected = useMemo(() => {
        if (!asset) {
            return null;
        }
        const timeline = getStoryMotionTimeline(asset);
        const track = timeline.tracks.find(item => item.id === selection.trackId);
        if (!track) {
            return null;
        }
        const keyframe = track.keyframes.find(item => item.id === selection.keyframeId);
        return track && keyframe ? { track, keyframe } : null;
    }, [asset, selection.keyframeId, selection.trackId]);

    useEffect(() => {
        if (asset && !selected) {
            clearSelection();
        }
    }, [asset, clearSelection, selected]);

    const updateKeyframe = useCallback((updater: (keyframe: StoryAnimationKeyframe, track: StoryAnimationTrack) => StoryAnimationKeyframe) => {
        setAsset(current => {
            if (!current) {
                return current;
            }
            const next = storyService.updateAnimationAsset(selection.animationId, motion => ({
                ...motion,
                timeline: updateStoryMotionKeyframe(getStoryMotionTimeline(motion), selection.keyframeId, updater),
            }));
            return next;
        });
    }, [selection.animationId, selection.keyframeId, storyService]);

    const deleteKeyframe = useCallback((data: StoryMotionKeyframeInspectorData) => {
        setAsset(current => {
            if (!current) {
                return current;
            }
            const next = storyService.updateAnimationAsset(selection.animationId, motion => ({
                ...motion,
                timeline: deleteStoryMotionKeyframe(getStoryMotionTimeline(motion), data.keyframe.id),
            }));
            return next;
        });
        clearSelection();
    }, [clearSelection, selection.animationId, storyService]);

    const schema = useMemo(
        () => createStoryMotionKeyframeSchema(updateKeyframe, deleteKeyframe),
        [deleteKeyframe, updateKeyframe],
    );

    if (!asset || !selected) {
        return (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-gray-500">
                Loading keyframe...
            </div>
        );
    }

    return (
        <PropertyEditor
            schema={schema}
            data={{
                asset,
                track: selected.track,
                keyframe: selected.keyframe,
            }}
        />
    );
}

function createStoryMotionKeyframeSchema(
    updateKeyframe: (updater: (keyframe: StoryAnimationKeyframe, track: StoryAnimationTrack) => StoryAnimationKeyframe) => void,
    deleteKeyframe: (data: StoryMotionKeyframeInspectorData) => void,
): PropertyEditorSchema<StoryMotionKeyframeInspectorData> {
    return createPropertyEditorSchema<StoryMotionKeyframeInspectorData>({
        id: "story-motion-keyframe",
        fields: [
            defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                id: "summary",
                type: "info",
                items: data => {
                    const meta = getStoryMotionPropertyMeta(data.track.property);
                    return [
                        { label: "Motion", getValue: () => data.asset.name },
                        { label: "Property", getValue: () => meta.label },
                        { label: "Time", getValue: () => formatStoryMotionTime(data.keyframe.timeMs) },
                    ];
                },
            }),
            defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                id: "timeMs",
                type: "number",
                label: "Time ms",
                min: 0,
                max: STORY_MOTION_MAX_DURATION_MS,
                step: 1,
                getValue: data => data.keyframe.timeMs,
                setValue: (_data, value) => {
                    updateKeyframe(keyframe => ({
                        ...keyframe,
                        timeMs: clampStoryMotionTimeMs(value),
                    }));
                },
            }),
            defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                id: "easing",
                type: "select",
                label: "Easing",
                options: [
                    { value: "", label: "Default" },
                    ...STORY_MOTION_EASING_OPTIONS,
                    { value: CUSTOM_EASING_OPTION, label: "Custom" },
                ],
                getValue: data => {
                    const easing = data.keyframe.easing ?? "";
                    return isStoryMotionBezierEasing(easing) ? CUSTOM_EASING_OPTION : easing;
                },
                setValue: (data, value) => {
                    const raw = String(value || "");
                    const easing = raw === CUSTOM_EASING_OPTION
                        ? (isStoryMotionBezierEasing(data.keyframe.easing) ? data.keyframe.easing : DEFAULT_CUSTOM_BEZIER)
                        : raw || undefined;
                    updateKeyframe(keyframe => ({
                        ...keyframe,
                        easing,
                    }));
                },
            }),
            defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                id: "easing-curve",
                type: "custom",
                hidden: data => !isStoryMotionBezierEasing(data.keyframe.easing),
                component: ({ data }) => (
                    <StoryMotionBezierEditor
                        easing={data.keyframe.easing ?? DEFAULT_CUSTOM_BEZIER}
                        onChange={easing => {
                            updateKeyframe(keyframe => ({
                                ...keyframe,
                                easing,
                            }));
                        }}
                    />
                ),
            }),
            defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                id: "value",
                type: "section",
                title: "Value",
                fields: [
                    defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                        id: "position",
                        type: "inputGroup",
                        hidden: data => getStoryMotionPropertyMeta(data.track.property).valueKind !== "position",
                        wrap: true,
                        inputs: [
                            positionInput(updateKeyframe, "xalign", "X align", 0.5, 0.01),
                            positionInput(updateKeyframe, "yalign", "Y align", 0.55, 0.01),
                            positionInput(updateKeyframe, "xoffset", "X offset", 0, 1),
                            positionInput(updateKeyframe, "yoffset", "Y offset", 0, 1),
                        ],
                    }),
                    defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                        id: "number",
                        type: "number",
                        label: "Value",
                        step: 0.01,
                        hidden: data => getStoryMotionPropertyMeta(data.track.property).valueKind !== "number",
                        getValue: data => typeof data.keyframe.value === "number" ? data.keyframe.value : 0,
                        setValue: (_data, value) => {
                            updateKeyframe(keyframe => ({
                                ...keyframe,
                                value,
                            }));
                        },
                    }),
                    defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                        id: "text",
                        type: "text",
                        label: "Value",
                        hidden: data => getStoryMotionPropertyMeta(data.track.property).valueKind !== "text",
                        getValue: data => typeof data.keyframe.value === "string" ? data.keyframe.value : "",
                        setValue: (_data, value) => {
                            updateKeyframe(keyframe => ({
                                ...keyframe,
                                value,
                            }));
                        },
                    }),
                ],
            }),
            defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                id: "delete",
                type: "custom",
                component: ({ data }) => (
                    <SurfaceEditorToolbarButtonGroup aria-label="Keyframe actions" className="w-full">
                        <SurfaceEditorToolbarSegButton
                            type="button"
                            className="!w-auto flex-1 gap-2 px-3 !text-gray-300 hover:!bg-red-500/10 hover:!text-red-100 focus-visible:!ring-red-400/40"
                            onClick={() => deleteKeyframe(data)}
                            title="Delete keyframe"
                        >
                            <Trash2 className="h-4 w-4" />
                            <span>Delete keyframe</span>
                        </SurfaceEditorToolbarSegButton>
                    </SurfaceEditorToolbarButtonGroup>
                ),
            }),
        ],
    });
}

function positionInput(
    updateKeyframe: (updater: (keyframe: StoryAnimationKeyframe, track: StoryAnimationTrack) => StoryAnimationKeyframe) => void,
    key: keyof Required<StoryAlignPositionValue>,
    label: string,
    fallback: number,
    step: number,
) {
    return {
        id: key,
        label,
        type: "number" as const,
        precision: step < 1 ? 2 : 0,
        getValue: (data: StoryMotionKeyframeInspectorData) => String(readPositionValue(data.keyframe.value, key, fallback)),
        setValue: (data: StoryMotionKeyframeInspectorData, raw: string) => {
            const next = Number(raw);
            if (!Number.isFinite(next)) {
                return;
            }
            const current = readPosition(data.keyframe.value);
            const value: Required<StoryAlignPositionValue> = {
                ...current,
                [key]: next,
            };
            updateKeyframe(keyframe => ({
                ...keyframe,
                value,
            }));
        },
    };
}

function readPosition(value: StoryAnimationKeyframeValue): Required<StoryAlignPositionValue> {
    if (!value || typeof value !== "object") {
        return {
            xalign: 0.5,
            yalign: 0.55,
            xoffset: 0,
            yoffset: 0,
        };
    }
    return {
        xalign: readPositionValue(value, "xalign", 0.5),
        yalign: readPositionValue(value, "yalign", 0.55),
        xoffset: readPositionValue(value, "xoffset", 0),
        yoffset: readPositionValue(value, "yoffset", 0),
    };
}

function readPositionValue(
    value: StoryAnimationKeyframeValue,
    key: keyof Required<StoryAlignPositionValue>,
    fallback: number,
): number {
    return value && typeof value === "object" && Number.isFinite(Number(value[key]))
        ? Number(value[key])
        : fallback;
}

const BEZIER_VIEW_SIZE = 160;
const BEZIER_Y_MIN = -0.5;
const BEZIER_Y_MAX = 1.5;

function StoryMotionBezierEditor(props: { easing: string; onChange: (easing: string) => void }) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const points = useMemo<[number, number, number, number]>(() => {
        const parsed = parseStoryEasing(props.easing);
        return Array.isArray(parsed) ? parsed : [0.42, 0, 0.58, 1];
    }, [props.easing]);

    const toX = (value: number) => value * BEZIER_VIEW_SIZE;
    const toY = (value: number) => (BEZIER_Y_MAX - value) / (BEZIER_Y_MAX - BEZIER_Y_MIN) * BEZIER_VIEW_SIZE;

    const startHandleDrag = (event: ReactPointerEvent<SVGCircleElement>, handle: 0 | 1) => {
        event.preventDefault();
        event.stopPropagation();
        const svg = svgRef.current;
        if (!svg) {
            return;
        }
        const onMove = (moveEvent: PointerEvent) => {
            const rect = svg.getBoundingClientRect();
            const x = Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width));
            const y = BEZIER_Y_MAX - (moveEvent.clientY - rect.top) / rect.height * (BEZIER_Y_MAX - BEZIER_Y_MIN);
            const clampedY = Math.min(BEZIER_Y_MAX, Math.max(BEZIER_Y_MIN, y));
            const next: [number, number, number, number] = handle === 0
                ? [x, clampedY, points[2], points[3]]
                : [points[0], points[1], x, clampedY];
            props.onChange(formatStoryBezierEasing(next));
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    return (
        <div className="grid gap-1.5">
            <svg
                ref={svgRef}
                viewBox={`0 0 ${BEZIER_VIEW_SIZE} ${BEZIER_VIEW_SIZE}`}
                className="w-full touch-none rounded border border-white/10 bg-black/20"
            >
                <rect x={0} y={toY(1)} width={BEZIER_VIEW_SIZE} height={toY(0) - toY(1)} fill="rgba(255,255,255,0.03)" />
                <line x1={0} y1={toY(0)} x2={BEZIER_VIEW_SIZE} y2={toY(0)} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
                <line x1={0} y1={toY(1)} x2={BEZIER_VIEW_SIZE} y2={toY(1)} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
                <line x1={toX(0)} y1={toY(0)} x2={toX(points[0])} y2={toY(points[1])} stroke="rgba(148,163,184,0.5)" strokeWidth={1} />
                <line x1={toX(1)} y1={toY(1)} x2={toX(points[2])} y2={toY(points[3])} stroke="rgba(148,163,184,0.5)" strokeWidth={1} />
                <path
                    d={`M ${toX(0)} ${toY(0)} C ${toX(points[0])} ${toY(points[1])}, ${toX(points[2])} ${toY(points[3])}, ${toX(1)} ${toY(1)}`}
                    fill="none"
                    stroke="#1f9eff"
                    strokeWidth={2}
                />
                <circle
                    cx={toX(points[0])}
                    cy={toY(points[1])}
                    r={5}
                    fill="#1f9eff"
                    stroke="rgba(255,255,255,0.8)"
                    className="cursor-grab"
                    onPointerDown={event => startHandleDrag(event, 0)}
                />
                <circle
                    cx={toX(points[2])}
                    cy={toY(points[3])}
                    r={5}
                    fill="#1f9eff"
                    stroke="rgba(255,255,255,0.8)"
                    className="cursor-grab"
                    onPointerDown={event => startHandleDrag(event, 1)}
                />
            </svg>
            <div className="text-center text-[11px] tabular-nums text-slate-500">{formatStoryBezierEasing(points)}</div>
        </div>
    );
}

function clearStoryMotionKeyframeSelection(uiService: UIService, selection: StoryMotionKeyframeSelection): void {
    const current = uiService.getStore().getSelection();
    if (
        current.type === STORY_MOTION_KEYFRAME_SELECTION_TYPE
        && isStoryMotionKeyframeSelectionData(current.data)
        && current.data.animationId === selection.animationId
        && current.data.keyframeId === selection.keyframeId
    ) {
        uiService.getStore().setSelection({ type: null, data: null });
    }
}
