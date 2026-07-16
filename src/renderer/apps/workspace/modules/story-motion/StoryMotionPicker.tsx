import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Edit3, Plus, Search, Spline, X } from "lucide-react";
import type {
    StoryAnimationAsset,
    StoryAnimationIndexEntry,
    StoryDisplayableTargetKind,
    StoryTransformRef,
} from "@shared/types/story";
import { useTranslation, type UseTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { Select } from "@/lib/components/elements/Select";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { createStoryMotionEditorTab } from "./StoryMotionEditorTab";
import type { StoryMotionActionContext } from "./storyMotionTypes";
import {
    STORY_MOTION_TEMPLATES,
    createStoryMotionName,
    createStoryMotionTemplateTimeline,
    getStoryMotionDurationMs,
    getStoryMotionPropertyMeta,
    type StoryMotionTemplateName,
} from "./storyMotionTimeline";

const ICON_BUTTON_CLASS = controlButtonClass();
const TOOL_BUTTON_CLASS = "inline-flex h-8 items-center gap-1.5 rounded border border-edge bg-fill-subtle px-2 text-xs text-fg hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";

const STORY_MOTION_TEMPLATE_KEYS = {
    "Fade in + slide": "fadeInSlide",
    "Center pop": "centerPop",
    "Look around": "lookAround",
    "Flash": "flash",
} as const satisfies Record<StoryMotionTemplateName, string>;

export function StoryMotionPicker(props: {
    value: StoryTransformRef | undefined;
    targetKind: StoryDisplayableTargetKind;
    motionLabel: string;
    actionContext: StoryMotionActionContext;
    onChange: (value: StoryTransformRef | undefined) => void;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const storyService = useMemo(
        () => context && isInitialized ? context.services.get<StoryService>(Services.Story) : null,
        [context, isInitialized],
    );
    const animationId = props.value?.mode === "animation" ? props.value.animationId : undefined;
    const [assets, setAssets] = useState<StoryAnimationIndexEntry[]>([]);
    const [selectedAsset, setSelectedAsset] = useState<StoryAnimationAsset | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [template, setTemplate] = useState<typeof STORY_MOTION_TEMPLATES[number]>("Fade in + slide");
    const templateOptions = useMemo(() => STORY_MOTION_TEMPLATES.map(option => ({
        value: option,
        label: t(`motion.templates.${STORY_MOTION_TEMPLATE_KEYS[option]}`),
    })), [t]);

    useEffect(() => {
        if (!storyService) {
            setAssets([]);
            return;
        }
        setAssets([...storyService.listAnimationAssets()]);
        return storyService.onAnimationsChanged(index => setAssets([...index.animations]));
    }, [storyService]);

    useEffect(() => {
        if (!storyService || !animationId) {
            setSelectedAsset(null);
            return;
        }
        let disposed = false;
        void storyService.loadAnimationAsset(animationId)
            .then(asset => {
                if (!disposed) {
                    setSelectedAsset(asset);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setSelectedAsset(null);
                }
            });
        return () => {
            disposed = true;
        };
    }, [animationId, storyService]);

    const filteredAssets = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return assets.filter(asset => !needle
            || asset.name.toLowerCase().includes(needle)
            || asset.id.toLowerCase().includes(needle)
            || asset.targetKind.toLowerCase().includes(needle));
    }, [assets, query]);

    const bindAsset = useCallback((assetId: string) => {
        props.onChange({
            ...(props.value ?? {}),
            mode: "animation",
            animationId: assetId,
            preset: undefined,
        });
        setPickerOpen(false);
    }, [props]);

    const createAndBind = useCallback(async () => {
        if (!storyService) {
            return;
        }
        const asset = await storyService.createAnimationAsset({
            name: createStoryMotionName(props.targetKind, template),
            targetKind: props.targetKind,
            timeline: createStoryMotionTemplateTimeline(template),
        });
        props.onChange({
            ...(props.value ?? {}),
            mode: "animation",
            animationId: asset.id,
            preset: undefined,
        });
        setPickerOpen(false);
    }, [props, storyService, template]);

    const openEditor = useCallback((assetId: string | undefined) => {
        if (!assetId) {
            return;
        }
        openEditorTab(createStoryMotionEditorTab({
            animationId: assetId,
            actionContext: props.actionContext,
        }));
    }, [openEditorTab, props.actionContext]);

    return (
        <div className="rounded-lg border border-edge bg-fill-subtle p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-fg-muted">{t("motion.storyMotion")}</div>
                <button
                    type="button"
                    className={TOOL_BUTTON_CLASS}
                    onClick={() => setPickerOpen(value => !value)}
                >
                    <Spline className="h-3.5 w-3.5" />
                    {animationId ? t("motion.picker.change") : t("motion.picker.choose")}
                </button>
            </div>

            {animationId ? (
                <div className="flex min-w-0 items-center gap-2 rounded border border-primary/25 bg-primary/10 p-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-primary/25 bg-primary/15 text-primary">
                        <Spline className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-primary">{selectedAsset?.name ?? props.motionLabel}</div>
                        <div className="truncate text-2xs text-fg-muted">
                            {selectedAsset ? motionSummary(selectedAsset, t) : t("motion.picker.assetFallback", { id: animationId ?? "" })}
                        </div>
                    </div>
                    <button className={ICON_BUTTON_CLASS} type="button" onClick={() => openEditor(animationId)} title={t("motion.editMotion")}>
                        <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                        className={ICON_BUTTON_CLASS}
                        type="button"
                        onClick={() => props.onChange({ mode: "preset", preset: "none" })}
                        title={t("motion.clearMotion")}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            ) : (
                <div className="rounded border border-dashed border-edge bg-fill-subtle p-3 text-xs text-fg-subtle">
                    {t("motion.picker.noMotionBound")}
                </div>
            )}

            {pickerOpen ? (
                <div className="mt-2 rounded-lg border border-edge bg-surface p-2 shadow-xl">
                    <div className="flex items-center gap-2">
                        <EnhancedInput
                            className="flex-1"
                            value={query}
                            onChange={setQuery}
                            placeholder={t("motion.searchStoryMotions")}
                            leftIcon={<Search className="h-3.5 w-3.5 text-fg-subtle" />}
                        />
                        <Select
                            className="w-44"
                            size="sm"
                            options={templateOptions}
                            value={template}
                            onChange={value => setTemplate(value as typeof STORY_MOTION_TEMPLATES[number])}
                            portalMenu
                            menuZIndex={80}
                        />
                        <button className={TOOL_BUTTON_CLASS} type="button" onClick={createAndBind} disabled={!storyService}>
                            <Plus className="h-3.5 w-3.5" />
                            {t("common.create")}
                        </button>
                    </div>
                    <div className="mt-2 max-h-56 overflow-auto rounded border border-edge-subtle">
                        {filteredAssets.length === 0 ? (
                            <div className="p-4 text-xs text-fg-subtle">{t("motion.picker.noMatches")}</div>
                        ) : filteredAssets.map(asset => (
                            <button
                                key={asset.id}
                                type="button"
                                className={[
                                    "flex w-full items-center gap-2 border-b border-edge-subtle px-3 py-2 text-left last:border-b-0",
                                    animationId === asset.id ? "bg-primary/10" : "hover:bg-fill-subtle",
                                ].join(" ")}
                                onClick={() => bindAsset(asset.id)}
                            >
                                <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-edge bg-fill-subtle text-primary">
                                    <Spline className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium text-fg">{asset.name}</span>
                                    <span className="block truncate text-2xs text-fg-subtle">{t("motion.picker.previewKind", { kind: t(`motion.targetKind.${asset.targetKind}`) })}</span>
                                </span>
                                {animationId === asset.id ? <Check className="h-4 w-4 text-primary" /> : null}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function motionSummary(asset: StoryAnimationAsset, t: UseTranslation["t"]): string {
    const durationMs = getStoryMotionDurationMs(asset.timeline);
    const tracks = asset.timeline?.tracks ?? [];
    const labels = tracks
        .slice(0, 3)
        .map(track => t(`motion.propertyLabel.${track.property}`))
        .join(", ");
    return `${durationMs}ms${labels ? ` / ${labels}${tracks.length > 3 ? "..." : ""}` : ""}`;
}
