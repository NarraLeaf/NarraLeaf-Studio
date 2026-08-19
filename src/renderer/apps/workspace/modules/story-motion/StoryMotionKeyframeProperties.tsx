import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { isStoryBezierEasing, STORY_DEFAULT_BEZIER_EASING } from "@shared/utils/storyEasing";
import { storyMsToSeconds, storySecondsToMs } from "@shared/utils/storyTime";
import type {
    StoryAlignPositionValue,
    StoryAnimationAsset,
    StoryAnimationKeyframe,
    StoryAnimationKeyframeValue,
    StoryAnimationTrack,
} from "@shared/types/story";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { useTranslation, type UseTranslation } from "@/lib/i18n";
import { EasingCurveEditor } from "../../components/ui/EasingCurveEditor";
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
    updateStoryMotionKeyframe,
} from "./storyMotionTimeline";

const CUSTOM_EASING_OPTION = "__custom";
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
    const { t } = useTranslation();
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
        () => createStoryMotionKeyframeSchema(t, updateKeyframe, deleteKeyframe),
        [deleteKeyframe, t, updateKeyframe],
    );

    if (!asset || !selected) {
        return (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-fg-subtle">
                {t("motion.keyframe.loading")}
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
    t: UseTranslation["t"],
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
                        { label: t("motion.keyframe.motionLabel"), getValue: () => data.asset.name },
                        { label: t("motion.property"), getValue: () => meta.label },
                        { label: t("motion.keyframe.time"), getValue: () => formatStoryMotionTime(data.keyframe.timeMs) },
                    ];
                },
            }),
            defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                id: "timeSeconds",
                type: "number",
                label: t("motion.keyframe.timeSeconds"),
                min: 0,
                max: storyMsToSeconds(STORY_MOTION_MAX_DURATION_MS),
                // 0.001s is one stored millisecond — the finest step the timeline can hold.
                step: 0.001,
                getValue: data => storyMsToSeconds(data.keyframe.timeMs),
                setValue: (_data, value) => {
                    updateKeyframe(keyframe => ({
                        ...keyframe,
                        timeMs: clampStoryMotionTimeMs(storySecondsToMs(value)),
                    }));
                },
            }),
            defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                id: "easing",
                type: "select",
                label: t("motion.keyframe.easing"),
                options: [
                    { value: "", label: t("motion.keyframe.easingDefault") },
                    ...STORY_MOTION_EASING_OPTIONS,
                    { value: CUSTOM_EASING_OPTION, label: t("motion.keyframe.easingCustom") },
                ],
                getValue: data => {
                    const easing = data.keyframe.easing ?? "";
                    return isStoryBezierEasing(easing) ? CUSTOM_EASING_OPTION : easing;
                },
                setValue: (data, value) => {
                    const raw = String(value || "");
                    const easing = raw === CUSTOM_EASING_OPTION
                        ? (isStoryBezierEasing(data.keyframe.easing) ? data.keyframe.easing : STORY_DEFAULT_BEZIER_EASING)
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
                hidden: data => !isStoryBezierEasing(data.keyframe.easing),
                component: ({ data }) => (
                    <EasingCurveEditor
                        easing={data.keyframe.easing ?? STORY_DEFAULT_BEZIER_EASING}
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
                title: t("motion.keyframe.value"),
                fields: [
                    defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                        id: "position",
                        type: "inputGroup",
                        hidden: data => getStoryMotionPropertyMeta(data.track.property).valueKind !== "position",
                        wrap: true,
                        inputs: [
                            positionInput(updateKeyframe, "xalign", t("motion.keyframe.xAlign"), 0.5, 0.01),
                            positionInput(updateKeyframe, "yalign", t("motion.keyframe.yAlign"), 0.55, 0.01),
                            positionInput(updateKeyframe, "xoffset", t("motion.keyframe.xOffset"), 0, 1),
                            positionInput(updateKeyframe, "yoffset", t("motion.keyframe.yOffset"), 0, 1),
                        ],
                    }),
                    defineField<StoryMotionKeyframeInspectorData, FieldDefinition<StoryMotionKeyframeInspectorData>>({
                        id: "number",
                        type: "number",
                        label: t("motion.keyframe.value"),
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
                        label: t("motion.keyframe.value"),
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
                    <SurfaceEditorToolbarButtonGroup aria-label={t("motion.keyframe.keyframeActions")} className="w-full">
                        <SurfaceEditorToolbarSegButton
                            type="button"
                            className="!w-auto flex-1 gap-2 px-3 !text-fg-muted hover:!bg-danger/10 hover:!text-danger focus-visible:!ring-danger/40"
                            onClick={() => deleteKeyframe(data)}
                            data-tip={t("motion.keyframe.deleteKeyframe")}
                        >
                            <Trash2 className="h-4 w-4" />
                            <span>{t("motion.keyframe.deleteKeyframe")}</span>
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
