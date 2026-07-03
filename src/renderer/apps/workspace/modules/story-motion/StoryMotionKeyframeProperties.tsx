import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
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
    STORY_MOTION_MAX_DURATION_MS,
    clampStoryMotionTimeMs,
    deleteStoryMotionKeyframe,
    formatStoryMotionTime,
    getStoryMotionPropertyMeta,
    getStoryMotionTimeline,
    isStoryMotionEditableProperty,
    updateStoryMotionKeyframe,
} from "./storyMotionTimeline";
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
        if (!track || !isStoryMotionEditableProperty(track.property)) {
            return null;
        }
        const keyframe = track?.keyframes.find(item => item.id === selection.keyframeId);
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
                    { value: "linear", label: "Linear" },
                    { value: "easeIn", label: "Ease in" },
                    { value: "easeOut", label: "Ease out" },
                    { value: "easeInOut", label: "Ease in out" },
                    { value: "backOut", label: "Back out" },
                ],
                getValue: data => data.keyframe.easing ?? "",
                setValue: (_data, value) => {
                    const easing = String(value || "");
                    updateKeyframe(keyframe => ({
                        ...keyframe,
                        easing: easing || undefined,
                    }));
                },
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
