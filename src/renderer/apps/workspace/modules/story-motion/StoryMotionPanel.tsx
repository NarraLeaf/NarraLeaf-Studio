import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Check, Copy, Edit3, Image as ImageIcon, Plus, Search, Spline, Trash2, Wallpaper, X } from "lucide-react";
import type {
    StoryAnimationAsset,
    StoryAnimationIndexEntry,
    StoryDocument,
    StoryTransformRef,
} from "@shared/types/story";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { AssetSelector } from "../assets/components/AssetSelector";
import type { PanelComponentProps } from "../types";
import type { EditorLayout } from "../../registry/types";
import {
    SurfaceEditorToolbarButtonGroup,
    SurfaceEditorToolbarSegButton,
} from "../ui-editor/editors/SurfaceEditorToolbarButtonGroup";
import { Button } from "@/lib/components/elements/Button";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { createStoryMotionEditorTab, resolveStoryMotionStageSize } from "./StoryMotionEditorTab";
import { getStoryMotionDescriptor } from "./storyMotionAction";
import {
    STORY_MOTION_KEYFRAME_SELECTION_TYPE,
    isStoryMotionKeyframeSelectionData,
    type StoryMotionActionContext,
    type StoryMotionPanelPayload,
} from "./storyMotionTypes";
import {
    STORY_MOTION_FPS,
    STORY_MOTION_TEMPLATES,
    createStoryMotionName,
    createStoryMotionTemplateTimeline,
    formatStoryMotionTime,
    getStoryMotionDurationMs,
    sampleStoryMotionPreview,
    type StoryMotionPreviewState,
    type StoryMotionTemplateName,
} from "./storyMotionTimeline";
import { StoryMotionStagePreview } from "./StoryMotionStagePreview";
import { resolveStoryMotionPreviewTarget, type StoryMotionPreviewTarget } from "./storyMotionPreviewTarget";

const ICON_BUTTON_CLASS = controlButtonClass();
const PREVIEW_LOOP_GAP_MS = 2000;
const PREVIEW_FRAME_MS = 1000 / STORY_MOTION_FPS;

const STORY_MOTION_TEMPLATE_KEYS = {
    "Fade in + slide": "fadeInSlide",
    "Center pop": "centerPop",
    "Look around": "lookAround",
    "Flash": "flash",
} as const satisfies Record<StoryMotionTemplateName, string>;

export function StoryMotionPanel({ payload }: PanelComponentProps<StoryMotionPanelPayload | undefined>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const storyService = useMemo(
        () => context && isInitialized ? context.services.get<StoryService>(Services.Story) : null,
        [context, isInitialized],
    );
    const uiService = useMemo(
        () => context && isInitialized ? context.services.get<UIService>(Services.UI) : null,
        [context, isInitialized],
    );
    const actionContext = useMemo(() => normalizeActionContext(payload), [payload]);
    const [assets, setAssets] = useState<StoryAnimationIndexEntry[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedAsset, setSelectedAsset] = useState<StoryAnimationAsset | null>(null);
    const [query, setQuery] = useState("");
    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [renameDraft, setRenameDraft] = useState("");
    const [previewTimeMs, setPreviewTimeMs] = useState(0);
    const [assetPickerFor, setAssetPickerFor] = useState<"target" | "background" | null>(null);
    const targetPickerButtonRef = useRef<HTMLButtonElement | null>(null);
    const backgroundPickerButtonRef = useRef<HTMLButtonElement | null>(null);
    const projectService = useMemo(
        () => context && isInitialized ? context.services.get<ProjectService>(Services.Project) : null,
        [context, isInitialized],
    );
    const assetsService = useMemo(
        () => context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null,
        [context, isInitialized],
    );
    const stageSize = useMemo(() => resolveStoryMotionStageSize(projectService), [projectService]);

    useEffect(() => {
        if (!storyService) {
            setAssets([]);
            return;
        }
        setAssets([...storyService.listAnimationAssets()]);
        return storyService.onAnimationsChanged(index => setAssets([...index.animations]));
    }, [storyService]);

    useEffect(() => {
        if (!storyService || !actionContext) {
            setDocument(null);
            return;
        }
        let disposed = false;
        void storyService.loadStory(actionContext.storyId)
            .then(next => {
                if (!disposed) {
                    setDocument(next);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setDocument(null);
                }
            });
        const dispose = storyService.onDocumentChanged(event => {
            if (event.storyId === actionContext.storyId) {
                setDocument(event.document);
            }
        });
        return () => {
            disposed = true;
            dispose();
        };
    }, [actionContext, storyService]);

    const block = useMemo(() => {
        if (!document || !actionContext) {
            return null;
        }
        return document.scenes[actionContext.sceneId]?.blocks[actionContext.blockId] ?? null;
    }, [actionContext, document]);
    const descriptor = useMemo(() => block ? getStoryMotionDescriptor(block) : null, [block]);
    const actionAnimationId = descriptor?.transform?.mode === "animation" ? descriptor.transform.animationId : undefined;

    useEffect(() => {
        if (actionAnimationId && assets.some(asset => asset.id === actionAnimationId)) {
            setSelectedId(actionAnimationId);
            return;
        }
        if (!selectedId || !assets.some(asset => asset.id === selectedId)) {
            setSelectedId(assets[0]?.id ?? null);
        }
    }, [actionAnimationId, assets, selectedId]);

    useEffect(() => {
        if (!storyService || !selectedId) {
            setSelectedAsset(null);
            setRenameDraft("");
            return;
        }
        let disposed = false;
        storyService.loadAnimationAsset(selectedId)
            .then(asset => {
                if (!disposed) {
                    setSelectedAsset(asset);
                    setRenameDraft(asset.name);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setSelectedAsset(null);
                    setRenameDraft("");
                }
            });
        // Keep the preview in sync with edits made elsewhere (e.g. the full editor tab).
        const unsubscribe = storyService.onAnimationsChanged(() => {
            void storyService.loadAnimationAsset(selectedId)
                .then(asset => {
                    if (!disposed) {
                        setSelectedAsset(asset);
                    }
                })
                .catch(() => undefined);
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [selectedId, storyService]);

    const filteredAssets = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return assets.filter(asset => !needle
            || asset.name.toLowerCase().includes(needle)
            || asset.id.toLowerCase().includes(needle)
            || asset.targetKind.toLowerCase().includes(needle));
    }, [assets, query]);

    const createMotion = useCallback(async (templateName?: typeof STORY_MOTION_TEMPLATES[number]) => {
        if (!storyService) {
            return;
        }
        const targetKind = descriptor?.targetKind ?? "image";
        const asset = await storyService.createAnimationAsset({
            name: createStoryMotionName(targetKind, templateName),
            targetKind,
            timeline: createStoryMotionTemplateTimeline(templateName),
        });
        setSelectedId(asset.id);
    }, [descriptor?.targetKind, storyService]);

    const openCreateMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        showMenu(event);
    }, [showMenu]);

    const createMenuItems = useMemo<ContextMenuDef>(() => [
        {
            id: "new-motion",
            label: t("motion.panel.newMotion"),
            icon: <Plus className="h-4 w-4" />,
            onClick: () => {
                void createMotion();
            },
        },
        ...STORY_MOTION_TEMPLATES.map(templateName => ({
            id: `preset-${templateName}`,
            label: t(`motion.templates.${STORY_MOTION_TEMPLATE_KEYS[templateName]}`),
            icon: <Spline className="h-4 w-4" />,
            onClick: () => {
                void createMotion(templateName);
            },
        })),
    ], [createMotion, t]);

    const duplicateMotion = useCallback(async () => {
        if (!storyService || !selectedAsset) {
            return;
        }
        const asset = await storyService.createAnimationAsset({
            name: `${selectedAsset.name} copy`,
            targetKind: selectedAsset.targetKind,
            timeline: selectedAsset.timeline ? clone(selectedAsset.timeline) : undefined,
            sequences: clone(selectedAsset.sequences),
        });
        setSelectedId(asset.id);
    }, [selectedAsset, storyService]);

    const deleteMotion = useCallback(async () => {
        if (!storyService || !uiService || !selectedAsset) {
            return;
        }
        const confirmed = await uiService.showConfirm(
            t("motion.panel.deleteConfirm", { name: selectedAsset.name }),
            t("motion.panel.deleteDetail"),
        );
        if (!confirmed) {
            return;
        }
        const animationId = selectedAsset.id;
        storyService.deleteAnimationAsset(animationId);
        clearStoryMotionSelectionForAnimation(uiService, animationId);
        closeStoryMotionEditorTabs(uiService, animationId);
        setSelectedId(null);
        setSelectedAsset(null);
    }, [selectedAsset, storyService, uiService, t]);

    const commitRename = useCallback(() => {
        if (!storyService || !selectedAsset) {
            return;
        }
        const nextName = renameDraft.trim();
        if (!nextName || nextName === selectedAsset.name) {
            setRenameDraft(selectedAsset.name);
            return;
        }
        const next = storyService.updateAnimationAsset(selectedAsset.id, asset => ({ ...asset, name: nextName }));
        setSelectedAsset(next);
    }, [renameDraft, selectedAsset, storyService]);

    const bindToAction = useCallback(() => {
        if (!storyService || !actionContext || !block || !descriptor || !selectedAsset) {
            return;
        }
        const transform: StoryTransformRef = {
            ...(descriptor.transform ?? {}),
            mode: "animation",
            animationId: selectedAsset.id,
        };
        storyService.updateBlock(actionContext.storyId, actionContext.sceneId, block.id, descriptor.setTransform(transform));
    }, [actionContext, block, descriptor, selectedAsset, storyService]);

    const setPreviewAsset = useCallback((field: "previewAssetId" | "previewBackgroundAssetId", assetId: string | undefined) => {
        if (!storyService || !selectedAsset) {
            return;
        }
        const next = storyService.updateAnimationAsset(selectedAsset.id, asset => ({ ...asset, [field]: assetId }));
        setSelectedAsset(next);
    }, [selectedAsset, storyService]);

    const handlePreviewAssetConfirm = useCallback((assets: Asset[]) => {
        if (assetPickerFor) {
            setPreviewAsset(assetPickerFor === "target" ? "previewAssetId" : "previewBackgroundAssetId", assets[0]?.id);
        }
        setAssetPickerFor(null);
    }, [assetPickerFor, setPreviewAsset]);

    const setConfig = useCallback((patch: { repeat?: number; repeatDelayMs?: number }, clear: ("repeat" | "repeatDelayMs")[] = []) => {
        if (!storyService || !selectedAsset) {
            return;
        }
        const next = storyService.updateAnimationAsset(selectedAsset.id, asset => {
            const config = { ...asset.config, ...patch };
            for (const key of clear) {
                delete config[key];
            }
            return { ...asset, config };
        });
        setSelectedAsset(next);
    }, [selectedAsset, storyService]);

    const imageAssetName = useCallback((assetId: string | undefined) => {
        if (!assetId) {
            return null;
        }
        return assetsService?.getAssets()[AssetType.Image]?.[assetId]?.name ?? assetId;
    }, [assetsService]);

    const openFullEditor = useCallback(() => {
        if (!selectedAsset) {
            return;
        }
        openEditorTab(createStoryMotionEditorTab({
            animationId: selectedAsset.id,
            actionContext: actionContext ?? undefined,
        }));
    }, [actionContext, openEditorTab, selectedAsset]);

    const previewTimeline = useMemo(() => {
        return selectedAsset?.timeline ?? createStoryMotionTemplateTimeline("Fade in + slide");
    }, [selectedAsset?.timeline]);
    const previewDurationMs = useMemo(() => getStoryMotionDurationMs(previewTimeline), [previewTimeline]);
    useEffect(() => {
        if (!selectedAsset) {
            setPreviewTimeMs(0);
            return;
        }
        let frame = 0;
        let startedAt: number | null = null;
        let lastPaint = 0;
        const duration = Math.max(1, previewDurationMs);
        const cycleDuration = duration + PREVIEW_LOOP_GAP_MS;
        const tick = (time: number) => {
            if (startedAt === null) {
                startedAt = time;
            }
            if (lastPaint === 0 || time - lastPaint >= PREVIEW_FRAME_MS) {
                const elapsed = (time - startedAt) % cycleDuration;
                setPreviewTimeMs(Math.round(Math.min(elapsed, duration)));
                lastPaint = time;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [previewDurationMs, selectedAsset?.id]);
    const preview = useMemo(() => {
        return sampleStoryMotionPreview(previewTimeline, previewTimeMs);
    }, [previewTimeMs, previewTimeline]);
    const previewTarget = useMemo(() => resolveStoryMotionPreviewTarget({
        document,
        sceneId: actionContext?.sceneId,
        blockId: actionContext?.blockId,
        fallbackKind: selectedAsset?.targetKind ?? descriptor?.targetKind ?? "image",
        fallbackLabel: selectedAsset?.name ?? "Motion",
        previewAssetId: selectedAsset?.previewAssetId,
    }), [actionContext?.blockId, actionContext?.sceneId, descriptor?.targetKind, document, selectedAsset?.name, selectedAsset?.previewAssetId, selectedAsset?.targetKind]);
    const { url: previewBackgroundUrl } = useAssetObjectUrl(selectedAsset?.previewBackgroundAssetId ?? null);

    return (
        <div className="flex h-full min-h-0 bg-surface text-fg">
            <aside className="flex w-64 shrink-0 flex-col border-r border-edge">
                <div className="flex items-center gap-2 border-b border-edge p-2">
                    <EnhancedInput
                        className="flex-1"
                        value={query}
                        onChange={setQuery}
                        placeholder={t("motion.panel.searchPlaceholder")}
                        leftIcon={<Search className="h-3.5 w-3.5 text-fg-subtle" />}
                    />
                    <button className={ICON_BUTTON_CLASS} type="button" onClick={openCreateMenu} title={t("motion.panel.createMotion")} aria-label={t("motion.panel.createMotion")}>
                        <Plus className="h-4 w-4" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto py-1">
                    {filteredAssets.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-fg-subtle">{t("motion.panel.empty")}</div>
                    ) : filteredAssets.map(asset => (
                        <button
                            key={asset.id}
                            type="button"
                            className={[
                                "flex w-full cursor-default items-center gap-2 border-l-2 border-transparent px-3 py-1.5 text-left hover:bg-fill",
                                selectedId === asset.id ? "border-primary bg-primary/20" : "",
                            ].join(" ")}
                            onClick={() => setSelectedId(asset.id)}
                            title={asset.name}
                        >
                            <Spline className="h-4 w-4 shrink-0 text-fg-muted" />
                            <span className="min-w-0 flex-1 truncate text-sm text-fg">{asset.name}</span>
                        </button>
                    ))}
                </div>
                <ContextMenu
                    items={createMenuItems}
                    position={menuState.position}
                    visible={menuState.visible}
                    onClose={hideMenu}
                    iconsEnabled
                />
            </aside>

            <main className="min-w-0 flex-1 p-4">
                {selectedAsset ? (
                    <div className="grid h-full min-h-0 grid-cols-[minmax(240px,3fr)_minmax(0,7fr)] gap-4">
                        <div className="min-h-0 overflow-auto">
                            <section className="rounded-lg border border-edge bg-fill-subtle p-4">
                                <div className="grid gap-4">
                                    <label className="grid min-w-0 gap-1.5">
                                        <span className="text-xs font-medium text-fg-subtle">{t("common.name")}</span>
                                        <EnhancedInput
                                            className="transition-colors focus-within:ring-0"
                                            value={renameDraft}
                                            onChange={setRenameDraft}
                                            onBlur={commitRename}
                                            onKeyDown={event => {
                                                if (event.key === "Enter") event.currentTarget.blur();
                                            }}
                                            inputClassName="font-medium"
                                        />
                                    </label>
                                    <SurfaceEditorToolbarButtonGroup aria-label={t("motion.panel.motionActions")} className="w-full">
                                        <SurfaceEditorToolbarSegButton
                                            className="!w-auto flex-1 gap-1.5 px-3"
                                            type="button"
                                            onClick={openFullEditor}
                                            title={t("motion.editMotion")}
                                        >
                                            <Edit3 className="h-3.5 w-3.5" />
                                            <span>{t("common.edit")}</span>
                                        </SurfaceEditorToolbarSegButton>
                                        <SurfaceEditorToolbarSegButton type="button" onClick={duplicateMotion} title={t("common.duplicate")} aria-label={t("common.duplicate")}>
                                            <Copy className="h-4 w-4" />
                                        </SurfaceEditorToolbarSegButton>
                                        <SurfaceEditorToolbarSegButton type="button" onClick={() => void deleteMotion()} title={t("common.delete")} aria-label={t("common.delete")}>
                                            <Trash2 className="h-4 w-4" />
                                        </SurfaceEditorToolbarSegButton>
                                    </SurfaceEditorToolbarButtonGroup>
                                    <div className="grid grid-cols-2 gap-3">
                                        <label className="grid min-w-0 gap-1.5">
                                            <span className="text-xs font-medium text-fg-subtle">{t("motion.panel.repeat")}</span>
                                            <NumericDraftEnhancedInput
                                                committedDisplay={selectedAsset.config?.repeat ? String(selectedAsset.config.repeat) : ""}
                                                draftResetKey={selectedAsset.id}
                                                placeholder="1"
                                                inputMode="numeric"
                                                onEmpty={() => setConfig({}, ["repeat"])}
                                                onFiniteNumber={value => {
                                                    const repeat = Math.floor(value);
                                                    setConfig(repeat > 0 ? { repeat } : {}, repeat > 0 ? [] : ["repeat"]);
                                                }}
                                            />
                                        </label>
                                        <label className="grid min-w-0 gap-1.5">
                                            <span className="text-xs font-medium text-fg-subtle">{t("motion.panel.repeatDelaySeconds")}</span>
                                            <NumericDraftEnhancedInput
                                                committedDisplay={selectedAsset.config?.repeatDelayMs ? formatStorySecondsValue(selectedAsset.config.repeatDelayMs) : ""}
                                                draftResetKey={selectedAsset.id}
                                                placeholder="0"
                                                inputMode="decimal"
                                                onEmpty={() => setConfig({}, ["repeatDelayMs"])}
                                                onFiniteNumber={seconds => {
                                                    const repeatDelayMs = Math.max(0, storySecondsToMs(seconds));
                                                    setConfig(repeatDelayMs > 0 ? { repeatDelayMs } : {}, repeatDelayMs > 0 ? [] : ["repeatDelayMs"]);
                                                }}
                                            />
                                        </label>
                                    </div>
                                </div>
                            </section>

                            {actionContext && descriptor ? (
                                <section className="mt-4 rounded-lg border border-primary/20 bg-primary/10 p-3">
                                    <div className="grid gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-xs font-medium text-primary">{descriptor.label}</div>
                                            <div className="mt-1 truncate text-2xs text-fg-muted">
                                                {actionAnimationId ? t("motion.panel.actionUses", { id: actionAnimationId }) : t("motion.panel.actionNoMotion")}
                                            </div>
                                        </div>
                                        <Button
                                            variant="secondary"
                                            size="md"
                                            type="button"
                                            onClick={bindToAction}
                                            className="h-9 justify-center"
                                        >
                                            <Check className="h-3.5 w-3.5" />
                                            {t("motion.panel.bindToAction")}
                                        </Button>
                                    </div>
                                </section>
                            ) : null}
                        </div>
                        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-edge">
                            <StoryMotionFittedStage
                                stageSize={stageSize}
                                preview={preview}
                                target={previewTarget}
                                backgroundUrl={previewBackgroundUrl}
                            />
                            <div className="flex h-10 shrink-0 items-center gap-2 border-t border-edge bg-surface px-2">
                                <PreviewAssetSlot
                                    buttonRef={targetPickerButtonRef}
                                    icon={<ImageIcon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />}
                                    label={imageAssetName(selectedAsset.previewAssetId) ?? t("motion.panel.target")}
                                    hasValue={Boolean(selectedAsset.previewAssetId)}
                                    title={t("motion.panel.previewTargetTitle")}
                                    onOpen={() => setAssetPickerFor("target")}
                                    onClear={() => setPreviewAsset("previewAssetId", undefined)}
                                />
                                <PreviewAssetSlot
                                    buttonRef={backgroundPickerButtonRef}
                                    icon={<Wallpaper className="h-3.5 w-3.5 shrink-0 text-fg-muted" />}
                                    label={imageAssetName(selectedAsset.previewBackgroundAssetId) ?? t("motion.panel.background")}
                                    hasValue={Boolean(selectedAsset.previewBackgroundAssetId)}
                                    title={t("motion.panel.previewBackgroundTitle")}
                                    onOpen={() => setAssetPickerFor("background")}
                                    onClear={() => setPreviewAsset("previewBackgroundAssetId", undefined)}
                                />
                                <span className="ml-auto shrink-0 text-2xs tabular-nums text-fg-subtle">
                                    {formatStoryMotionTime(previewDurationMs)}
                                </span>
                            </div>
                        </section>
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center text-sm text-fg-subtle">
                        {t("motion.panel.selectOrCreate")}
                    </div>
                )}
            </main>

            {selectedAsset ? (
                <AssetSelector
                    visible={assetPickerFor !== null}
                    assetType={AssetType.Image}
                    anchorRef={assetPickerFor === "background" ? backgroundPickerButtonRef : targetPickerButtonRef}
                    selectedIds={(() => {
                        const current = assetPickerFor === "background" ? selectedAsset.previewBackgroundAssetId : selectedAsset.previewAssetId;
                        return current ? [current] : [];
                    })()}
                    title={assetPickerFor === "background" ? t("motion.panel.previewBackground") : t("motion.panel.previewTarget")}
                    onClose={() => setAssetPickerFor(null)}
                    onConfirm={handlePreviewAssetConfirm}
                />
            ) : null}
        </div>
    );
}

function normalizeActionContext(payload: StoryMotionPanelPayload | undefined): StoryMotionActionContext | null {
    if (!payload?.storyId || !payload.sceneId || !payload.blockId) {
        return null;
    }
    return {
        storyId: payload.storyId,
        sceneId: payload.sceneId,
        blockId: payload.blockId,
        storyName: payload.storyName,
        sceneName: payload.sceneName,
    };
}

function clearStoryMotionSelectionForAnimation(uiService: UIService, animationId: string): void {
    const selection = uiService.getStore().getSelection();
    if (
        selection.type === STORY_MOTION_KEYFRAME_SELECTION_TYPE
        && isStoryMotionKeyframeSelectionData(selection.data)
        && selection.data.animationId === animationId
    ) {
        uiService.getStore().setSelection({ type: null, data: null });
    }
}

function closeStoryMotionEditorTabs(uiService: UIService, animationId: string): void {
    const tabs: Array<{ tabId: string; groupId: string }> = [];
    collectStoryMotionEditorTabs(uiService.getStore().getEditorLayout(), animationId, tabs);
    for (const tab of tabs) {
        uiService.getStore().closeEditorTabInGroup(tab.tabId, tab.groupId);
    }
}

function collectStoryMotionEditorTabs(
    layout: Readonly<EditorLayout>,
    animationId: string,
    acc: Array<{ tabId: string; groupId: string }>,
): void {
    if ("tabs" in layout) {
        for (const tab of layout.tabs) {
            const payload = tab.payload as Partial<{ animationId: string }> | undefined;
            const related = tab.id === `story-motion:${animationId}`
                || (payload && typeof payload === "object" && payload.animationId === animationId);
            if (related) {
                acc.push({ tabId: tab.id, groupId: layout.id });
            }
        }
        return;
    }
    collectStoryMotionEditorTabs(layout.first, animationId, acc);
    collectStoryMotionEditorTabs(layout.second, animationId, acc);
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function StoryMotionFittedStage(props: {
    stageSize: { width: number; height: number };
    preview: StoryMotionPreviewState;
    target: StoryMotionPreviewTarget;
    backgroundUrl?: string | null;
}) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [scale, setScale] = useState(0);
    const noopDrag = useCallback(() => undefined, []);

    useEffect(() => {
        const wrap = wrapRef.current;
        if (!wrap) {
            return;
        }
        const update = () => {
            const rect = wrap.getBoundingClientRect();
            const next = Math.min(rect.width / props.stageSize.width, rect.height / props.stageSize.height);
            setScale(current => Math.abs(current - next) < 0.001 ? current : Math.max(0, next));
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(wrap);
        return () => observer.disconnect();
    }, [props.stageSize.height, props.stageSize.width]);

    return (
        <div ref={wrapRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface">
            {scale > 0 ? (
                <div style={{ width: props.stageSize.width * scale, height: props.stageSize.height * scale }}>
                    <div
                        style={{
                            width: props.stageSize.width,
                            height: props.stageSize.height,
                            transform: `scale(${scale})`,
                            transformOrigin: "top left",
                        }}
                    >
                        <StoryMotionStagePreview
                            preview={props.preview}
                            target={props.target}
                            onPointerDrag={noopDrag}
                            interactive={false}
                            stageSize={props.stageSize}
                            showLabel={false}
                            backgroundUrl={props.backgroundUrl}
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function PreviewAssetSlot(props: {
    buttonRef: RefObject<HTMLButtonElement | null>;
    icon: ReactNode;
    label: string;
    hasValue: boolean;
    title: string;
    onOpen: () => void;
    onClear: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="flex min-w-0 max-w-56 items-center overflow-hidden rounded border border-edge bg-fill-subtle">
            <button
                ref={props.buttonRef}
                type="button"
                className={`flex h-7 min-w-0 flex-1 items-center gap-1.5 px-2 text-xs ${props.hasValue ? "text-fg" : "text-fg-subtle"} hover:bg-fill-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50`}
                onClick={props.onOpen}
                title={props.title}
            >
                {props.icon}
                <span className="min-w-0 truncate">{props.label}</span>
            </button>
            {props.hasValue ? (
                <button
                    type="button"
                    className="grid h-7 w-6 shrink-0 place-items-center border-l border-edge text-fg-subtle hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger/50"
                    onClick={props.onClear}
                    title={t("common.clear")}
                    aria-label={t("motion.panel.clearAria", { name: props.title })}
                >
                    <X className="h-3 w-3" />
                </button>
            ) : null}
        </div>
    );
}
