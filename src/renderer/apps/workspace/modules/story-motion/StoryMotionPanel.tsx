import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Activity, Check, Copy, Edit3, Plus, Search, Trash2 } from "lucide-react";
import type {
    StoryAnimationAsset,
    StoryAnimationIndexEntry,
    StoryDocument,
    StoryTransformRef,
} from "@shared/types/story";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { PanelComponentProps } from "../types";
import type { EditorLayout } from "../../registry/types";
import {
    SurfaceEditorToolbarButtonGroup,
    SurfaceEditorToolbarSegButton,
} from "../ui-editor/editors/SurfaceEditorToolbarButtonGroup";
import { Button } from "@/lib/components/elements/Button";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { createStoryMotionEditorTab } from "./StoryMotionEditorTab";
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
    getStoryMotionDurationMs,
    sampleStoryMotionPreview,
} from "./storyMotionTimeline";
import { StoryMotionStagePreview } from "./StoryMotionStagePreview";
import { resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";

const ICON_BUTTON_CLASS = controlButtonClass();
const PREVIEW_LOOP_GAP_MS = 2000;
const PREVIEW_FRAME_MS = 1000 / STORY_MOTION_FPS;

export function StoryMotionPanel({ payload }: PanelComponentProps<StoryMotionPanelPayload | undefined>) {
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

    useEffect(() => {
        if (!storyService) {
            setAssets([]);
            return;
        }
        setAssets(storyService.listAnimationAssets());
        return storyService.onAnimationsChanged(index => setAssets(index.animations));
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
        void storyService.loadAnimationAsset(selectedId)
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
        return () => {
            disposed = true;
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
            label: "New Motion",
            icon: <Plus className="h-4 w-4" />,
            onClick: () => {
                void createMotion();
            },
        },
        ...STORY_MOTION_TEMPLATES.map(templateName => ({
            id: `preset-${templateName}`,
            label: templateName,
            icon: <Activity className="h-4 w-4" />,
            onClick: () => {
                void createMotion(templateName);
            },
        })),
    ], [createMotion]);

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
            `Delete motion "${selectedAsset.name}"?`,
            "This removes the motion asset and closes related editors.",
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
    }, [selectedAsset, storyService, uiService]);

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
    }), [actionContext?.blockId, actionContext?.sceneId, descriptor?.targetKind, document, selectedAsset?.name, selectedAsset?.targetKind]);
    const ignorePreviewDrag = useCallback(() => undefined, []);

    return (
        <div className="flex h-full min-h-0 bg-[#101114] text-slate-200">
            <aside className="flex w-64 shrink-0 flex-col border-r border-white/10">
                <div className="flex items-center gap-2 border-b border-white/10 p-2">
                    <EnhancedInput
                        className="flex-1"
                        value={query}
                        onChange={setQuery}
                        placeholder="Search motions"
                        leftIcon={<Search className="h-3.5 w-3.5 text-slate-500" />}
                    />
                    <button className={ICON_BUTTON_CLASS} type="button" onClick={openCreateMenu} title="Create motion" aria-label="Create motion">
                        <Plus className="h-4 w-4" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto py-1">
                    {filteredAssets.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-gray-500">No motions.</div>
                    ) : filteredAssets.map(asset => (
                        <button
                            key={asset.id}
                            type="button"
                            className={[
                                "flex w-full cursor-default items-center gap-2 border-l-2 border-transparent px-3 py-1.5 text-left hover:bg-gray-600/30",
                                selectedId === asset.id ? "border-primary bg-primary/20" : "",
                            ].join(" ")}
                            onClick={() => setSelectedId(asset.id)}
                            title={asset.name}
                        >
                            <Activity className="h-4 w-4 shrink-0 text-gray-400" />
                            <span className="min-w-0 flex-1 truncate text-sm text-gray-100">{asset.name}</span>
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
                            <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                                <div className="grid gap-4">
                                    <label className="grid min-w-0 gap-1.5">
                                        <span className="text-xs font-medium text-slate-500">Name</span>
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
                                    <SurfaceEditorToolbarButtonGroup aria-label="Motion actions" className="w-full">
                                        <SurfaceEditorToolbarSegButton
                                            className="!w-auto flex-1 gap-1.5 px-3"
                                            type="button"
                                            onClick={openFullEditor}
                                            title="Edit motion"
                                        >
                                            <Edit3 className="h-3.5 w-3.5" />
                                            <span>Edit</span>
                                        </SurfaceEditorToolbarSegButton>
                                        <SurfaceEditorToolbarSegButton type="button" onClick={duplicateMotion} title="Duplicate" aria-label="Duplicate">
                                            <Copy className="h-4 w-4" />
                                        </SurfaceEditorToolbarSegButton>
                                        <SurfaceEditorToolbarSegButton type="button" onClick={() => void deleteMotion()} title="Delete" aria-label="Delete">
                                            <Trash2 className="h-4 w-4" />
                                        </SurfaceEditorToolbarSegButton>
                                    </SurfaceEditorToolbarButtonGroup>
                                </div>
                            </section>

                            {actionContext && descriptor ? (
                                <section className="mt-4 rounded-lg border border-primary/20 bg-primary/10 p-3">
                                    <div className="grid gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-xs font-medium text-primary">{descriptor.label}</div>
                                            <div className="mt-1 truncate text-[11px] text-slate-400">
                                                {actionAnimationId ? `Current action uses ${actionAnimationId}` : "Current action has no motion asset"}
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
                                            Bind to action
                                        </Button>
                                    </div>
                                </section>
                            ) : null}
                        </div>
                        <section className="flex min-h-0 overflow-hidden rounded-lg border border-white/10">
                            <StoryMotionStagePreview
                                preview={preview}
                                target={previewTarget}
                                onPointerDrag={ignorePreviewDrag}
                                interactive={false}
                            />
                        </section>
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        Select or create a story motion.
                    </div>
                )}
            </main>
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
