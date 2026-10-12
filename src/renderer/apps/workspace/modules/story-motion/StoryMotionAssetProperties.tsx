import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Edit3 } from "lucide-react";
import type { StoryAnimationAsset, StoryAnimationConfig } from "@shared/types/story";
import { formatStorySecondsLabel, storyMsToSeconds, storySecondsToMs } from "@shared/utils/storyTime";
import { Button } from "@/lib/components/elements/Button";
import { useTranslation, type UseTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Services } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { useFreezeGuard } from "../../components/ui/freezeGuard";
import { PropertyEditor, createPropertyEditorSchema, defineField } from "../properties/framework";
import type { CustomFieldProps, FieldDefinition, PropertyEditorSchema } from "../properties/framework/types";
import { AssetField } from "../story/scene-editor/AssetField";
import { createStoryMotionEditorTab, resolveStoryMotionStageSize } from "./StoryMotionEditorTab";
import { StoryMotionLoopPreview } from "./StoryMotionLoopPreview";
import { resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";
import { getStoryMotionDurationMs } from "./storyMotionTimeline";
import { STORY_MOTION_ASSET_SELECTION_TYPE, type StoryMotionAssetSelection } from "./storyMotionTypes";

type StoryMotionAssetInspectorData = {
    asset: StoryAnimationAsset;
};

type MotionWriter = (updater: (asset: StoryAnimationAsset) => StoryAnimationAsset) => void;

/**
 * The inspector for a motion as a whole: its name, how often it plays, and the pictures its preview
 * is drawn with.
 *
 * Reached from the library (selecting a motion) and from an open editor with no keyframe selected,
 * so a motion's own settings have one home whichever of the two the author is in.
 */
export function StoryMotionAssetProperties(props: {
    selection: StoryMotionAssetSelection;
    storyService: StoryService;
    uiService: UIService;
}) {
    const { selection, storyService, uiService } = props;
    const { t } = useTranslation();
    const [asset, setAsset] = useState<StoryAnimationAsset | null>(null);

    const clearSelection = useCallback(() => {
        const current = uiService.getStore().getSelection();
        if (current.type === STORY_MOTION_ASSET_SELECTION_TYPE && current.data.animationId === selection.animationId) {
            uiService.getStore().setSelection({ type: null, data: null });
        }
    }, [selection.animationId, uiService]);

    useEffect(() => {
        let disposed = false;
        const load = () => {
            void storyService.loadAnimationAsset(selection.animationId)
                .then(next => {
                    if (!disposed) {
                        setAsset(next);
                    }
                })
                .catch(() => {
                    if (!disposed) {
                        setAsset(null);
                    }
                });
        };
        load();
        const unsubscribe = storyService.onAnimationsChanged(index => {
            if (!index.animations.some(entry => entry.id === selection.animationId)) {
                setAsset(null);
                clearSelection();
                return;
            }
            load();
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [clearSelection, selection.animationId, storyService]);

    const write = useCallback<MotionWriter>(updater => {
        setAsset(storyService.updateAnimationAsset(selection.animationId, updater));
    }, [selection.animationId, storyService]);

    const schema = useMemo(() => createStoryMotionAssetSchema(t, write), [t, write]);

    if (!asset) {
        return (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-fg-subtle">
                {t("motion.editor.loading")}
            </div>
        );
    }
    return <PropertyEditor schema={schema} data={{ asset }} />;
}

function createStoryMotionAssetSchema(
    t: UseTranslation["t"],
    write: MotionWriter,
): PropertyEditorSchema<StoryMotionAssetInspectorData> {
    const setConfig = (patch: StoryAnimationConfig) => write(asset => {
        const config: StoryAnimationConfig = { ...asset.config, ...patch };
        // A setting at its default is not written: a motion that plays once carries no repeat.
        // `repeat` counts the plays after the first, as the engine reads it.
        if (!config.repeat || config.repeat <= 0) {
            delete config.repeat;
            delete config.repeatDelayMs;
        }
        if (!config.repeatDelayMs || config.repeatDelayMs <= 0) {
            delete config.repeatDelayMs;
        }
        return { ...asset, config };
    });
    return createPropertyEditorSchema<StoryMotionAssetInspectorData>({
        id: "story-motion-asset",
        fields: [
            defineField<StoryMotionAssetInspectorData, FieldDefinition<StoryMotionAssetInspectorData>>({
                id: "preview",
                type: "custom",
                component: MotionPreviewField,
            }),
            defineField<StoryMotionAssetInspectorData, FieldDefinition<StoryMotionAssetInspectorData>>({
                id: "name",
                type: "text",
                label: t("common.name"),
                getValue: data => data.asset.name,
                setValue: (data, value) => {
                    const name = value.trim();
                    if (name && name !== data.asset.name) {
                        write(asset => ({ ...asset, name }));
                    }
                },
            }),
            defineField<StoryMotionAssetInspectorData, FieldDefinition<StoryMotionAssetInspectorData>>({
                id: "summary",
                type: "info",
                items: [
                    { label: t("motion.inspector.target"), getValue: data => t(`motion.targetKind.${data.asset.targetKind}`) },
                    {
                        label: t("motion.inspector.duration"),
                        getValue: data => formatStorySecondsLabel(getStoryMotionDurationMs(data.asset.timeline)),
                    },
                    {
                        label: t("motion.inspector.properties"),
                        getValue: data => motionPropertyList(data.asset, t),
                    },
                ],
            }),
            defineField<StoryMotionAssetInspectorData, FieldDefinition<StoryMotionAssetInspectorData>>({
                id: "playback",
                type: "section",
                title: t("motion.inspector.playback"),
                fields: [
                    defineField<StoryMotionAssetInspectorData, FieldDefinition<StoryMotionAssetInspectorData>>({
                        id: "repeat",
                        type: "number",
                        label: t("motion.inspector.repeat"),
                        min: 0,
                        step: 1,
                        decimalPlaces: 0,
                        getValue: data => data.asset.config?.repeat ?? 0,
                        setValue: (_data, value) => setConfig({ repeat: Math.max(0, Math.floor(value)) }),
                    }),
                    defineField<StoryMotionAssetInspectorData, FieldDefinition<StoryMotionAssetInspectorData>>({
                        id: "repeatDelay",
                        type: "number",
                        label: t("motion.inspector.repeatDelaySeconds"),
                        min: 0,
                        step: 0.1,
                        decimalPlaces: 2,
                        // The pause only exists between plays.
                        hidden: data => (data.asset.config?.repeat ?? 0) <= 0,
                        getValue: data => storyMsToSeconds(data.asset.config?.repeatDelayMs ?? 0),
                        setValue: (_data, value) => setConfig({ repeatDelayMs: Math.max(0, storySecondsToMs(value)) }),
                    }),
                ],
            }),
            defineField<StoryMotionAssetInspectorData, FieldDefinition<StoryMotionAssetInspectorData>>({
                id: "previewImages",
                type: "section",
                title: t("motion.inspector.previewImages"),
                fields: (["previewAssetId", "previewBackgroundAssetId"] as const).map(slot => (
                    defineField<StoryMotionAssetInspectorData, FieldDefinition<StoryMotionAssetInspectorData>>({
                        id: slot,
                        type: "custom",
                        label: t(slot === "previewAssetId" ? "motion.inspector.previewTarget" : "motion.inspector.previewBackground"),
                        tip: t("motion.inspector.previewImagesTip"),
                        component: ({ data }: CustomFieldProps<StoryMotionAssetInspectorData>) => (
                            <PreviewImageField asset={data.asset} slot={slot} write={write} />
                        ),
                    })
                )),
            }),
            defineField<StoryMotionAssetInspectorData, FieldDefinition<StoryMotionAssetInspectorData>>({
                id: "open",
                type: "custom",
                component: OpenEditorButton,
            }),
        ],
    });
}

function motionPropertyList(asset: StoryAnimationAsset, t: UseTranslation["t"]): string {
    const tracks = asset.timeline?.tracks ?? [];
    if (tracks.length === 0) {
        return t("motion.inspector.noProperties");
    }
    return tracks.map(track => t(`motion.propertyLabel.${track.property}`)).join(t("motion.inspector.listSeparator"));
}

/**
 * The motion, playing on a loop at the inspector's width, drawn the way the editor draws it - the
 * preview images below are what it shows.
 */
function MotionPreviewField({ data }: CustomFieldProps<StoryMotionAssetInspectorData>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const projectService = useMemo(
        () => context && isInitialized ? context.services.get<ProjectService>(Services.Project) : null,
        [context, isInitialized],
    );
    const stageSize = useMemo(() => resolveStoryMotionStageSize(projectService), [projectService]);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const frame = frameRef.current;
        if (!frame || typeof ResizeObserver === "undefined") {
            return;
        }
        const measure = () => {
            const next = Math.floor(frame.getBoundingClientRect().width);
            setWidth(current => (current === next ? current : next));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(frame);
        return () => observer.disconnect();
    }, []);
    const height = width > 0 ? Math.round((width * stageSize.height) / stageSize.width) : 0;
    const target = useMemo(() => resolveStoryMotionPreviewTarget({
        document: null,
        sceneId: undefined,
        blockId: undefined,
        fallbackKind: data.asset.targetKind,
        fallbackLabel: data.asset.name || t("motion.fallbackLabel"),
        previewAssetId: data.asset.previewAssetId,
    }), [data.asset.name, data.asset.previewAssetId, data.asset.targetKind, t]);
    const { url: backgroundUrl } = useAssetObjectUrl(data.asset.previewBackgroundAssetId ?? null);

    return (
        <div ref={frameRef} className="overflow-hidden rounded-md border border-edge" style={{ height: height || undefined }}>
            {width > 0 ? (
                <StoryMotionLoopPreview
                    timeline={data.asset.timeline}
                    target={target}
                    stageSize={stageSize}
                    box={{ width, height }}
                    backgroundUrl={backgroundUrl}
                />
            ) : null}
        </div>
    );
}

/**
 * One of the two pictures the preview is drawn with. Picking one writes the motion, so a frozen
 * project shows which picture is set and refuses changing it.
 */
function PreviewImageField(props: {
    asset: StoryAnimationAsset;
    slot: "previewAssetId" | "previewBackgroundAssetId";
    write: MotionWriter;
}) {
    const freeze = useFreezeGuard();
    const { asset, slot, write } = props;
    return (
        <fieldset
            disabled={freeze.frozen}
            data-tip={freeze.frozen ? freeze.reason : undefined}
            className="m-0 min-w-0 border-0 p-0"
        >
            <AssetField
                compact
                assetType={AssetType.Image}
                assetId={asset[slot]}
                onChange={assetId => write(current => ({ ...current, [slot]: assetId }))}
            />
        </fieldset>
    );
}

function OpenEditorButton({ data }: CustomFieldProps<StoryMotionAssetInspectorData>) {
    const { t } = useTranslation();
    const { openEditorTab } = useRegistry();
    return (
        <Button
            variant="secondary"
            size="sm"
            className="w-full justify-center"
            onClick={() => openEditorTab(createStoryMotionEditorTab({ animationId: data.asset.id }))}
        >
            <Edit3 className="h-3.5 w-3.5" />
            {t("motion.editMotion")}
        </Button>
    );
}
