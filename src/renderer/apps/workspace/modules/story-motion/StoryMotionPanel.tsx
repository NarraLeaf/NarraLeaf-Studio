import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Check, Copy, Edit3, Plus, Search, Trash2 } from "lucide-react";
import type {
    StoryAnimationAsset,
    StoryAnimationIndexEntry,
    StoryDocument,
    StoryTransformRef,
} from "@shared/types/story";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { PanelComponentProps } from "../types";
import { createStoryMotionEditorTab } from "./StoryMotionEditorTab";
import { getStoryMotionDescriptor } from "./storyMotionAction";
import type { StoryMotionActionContext, StoryMotionPanelPayload } from "./storyMotionTypes";
import {
    STORY_MOTION_TEMPLATES,
    createStoryMotionName,
    createStoryMotionTemplateTimeline,
    getStoryMotionDurationMs,
    getStoryMotionPropertyMeta,
} from "./storyMotionTimeline";

const TOOL_BUTTON_CLASS = "inline-flex h-8 items-center gap-1.5 rounded border border-white/10 bg-white/[0.04] px-2 text-xs text-slate-200 hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";
const ICON_BUTTON_CLASS = "inline-grid h-8 w-8 place-items-center rounded border border-white/10 bg-white/[0.04] text-slate-300 hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";
const INPUT_CLASS = "h-8 rounded border border-white/10 bg-[#17191d] px-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-primary/50";

export function StoryMotionPanel({ payload }: PanelComponentProps<StoryMotionPanelPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const storyService = useMemo(
        () => context && isInitialized ? context.services.get<StoryService>(Services.Story) : null,
        [context, isInitialized],
    );
    const actionContext = useMemo(() => normalizeActionContext(payload), [payload]);
    const [assets, setAssets] = useState<StoryAnimationIndexEntry[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedAsset, setSelectedAsset] = useState<StoryAnimationAsset | null>(null);
    const [query, setQuery] = useState("");
    const [template, setTemplate] = useState<typeof STORY_MOTION_TEMPLATES[number]>("Fade in + slide");
    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [renameDraft, setRenameDraft] = useState("");

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

    const createMotion = useCallback(async () => {
        if (!storyService) {
            return;
        }
        const targetKind = descriptor?.targetKind ?? "image";
        const asset = await storyService.createAnimationAsset({
            name: createStoryMotionName(targetKind, template),
            targetKind,
            timeline: createStoryMotionTemplateTimeline(template),
        });
        setSelectedId(asset.id);
    }, [descriptor?.targetKind, storyService, template]);

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

    const deleteMotion = useCallback(() => {
        if (!storyService || !selectedAsset) {
            return;
        }
        if (!window.confirm(`Delete motion "${selectedAsset.name}"?`)) {
            return;
        }
        storyService.deleteAnimationAsset(selectedAsset.id);
        setSelectedId(null);
        setSelectedAsset(null);
    }, [selectedAsset, storyService]);

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

    return (
        <div className="flex h-full min-h-0 bg-[#101114] text-slate-200">
            <aside className="flex w-80 shrink-0 flex-col border-r border-white/10">
                <div className="flex h-10 items-center gap-2 border-b border-white/10 px-3">
                    <Activity className="h-4 w-4 text-primary" />
                    <div className="min-w-0 flex-1 text-sm font-medium">Story Motion Library</div>
                    <button className={ICON_BUTTON_CLASS} type="button" onClick={createMotion} title="Create motion">
                        <Plus className="h-4 w-4" />
                    </button>
                </div>
                <div className="grid gap-2 border-b border-white/10 p-2">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                        <input
                            className={`${INPUT_CLASS} w-full pl-7`}
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder="Search motions"
                        />
                    </div>
                    <div className="flex gap-2">
                        <select
                            className={`${INPUT_CLASS} min-w-0 flex-1`}
                            value={template}
                            onChange={event => setTemplate(event.target.value as typeof STORY_MOTION_TEMPLATES[number])}
                        >
                            {STORY_MOTION_TEMPLATES.map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <button className={TOOL_BUTTON_CLASS} type="button" onClick={createMotion}>
                            <Plus className="h-3.5 w-3.5" />
                            New
                        </button>
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                    {filteredAssets.length === 0 ? (
                        <div className="p-4 text-sm text-slate-500">No story motions yet.</div>
                    ) : filteredAssets.map(asset => (
                        <button
                            key={asset.id}
                            type="button"
                            className={[
                                "flex w-full items-center gap-3 border-b border-white/[0.06] px-3 py-2 text-left",
                                selectedId === asset.id ? "bg-primary/10" : "hover:bg-white/[0.04]",
                            ].join(" ")}
                            onClick={() => setSelectedId(asset.id)}
                        >
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.04] text-primary">
                                <Activity className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-slate-200">{asset.name}</span>
                                <span className="block truncate text-[11px] text-slate-500">Preview: {formatTargetKind(asset.targetKind)}</span>
                            </span>
                            {actionAnimationId === asset.id ? <Check className="h-4 w-4 text-primary" /> : null}
                        </button>
                    ))}
                </div>
            </aside>

            <main className="min-w-0 flex-1 p-4">
                {selectedAsset ? (
                    <div className="mx-auto grid max-w-4xl gap-4">
                        <section className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                            <div className="flex min-w-0 items-start gap-3">
                                <div className="grid h-12 w-12 shrink-0 place-items-center rounded border border-primary/25 bg-primary/10 text-primary">
                                    <Activity className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <input
                                        className={`${INPUT_CLASS} w-full max-w-md font-medium`}
                                        value={renameDraft}
                                        onChange={event => setRenameDraft(event.target.value)}
                                        onBlur={commitRename}
                                        onKeyDown={event => {
                                            if (event.key === "Enter") event.currentTarget.blur();
                                        }}
                                    />
                                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                        <span>{getStoryMotionDurationMs(selectedAsset.timeline)}ms</span>
                                        <span>{selectedAsset.timeline?.fps ?? 30}fps</span>
                                        <span>Preview: {formatTargetKind(selectedAsset.targetKind)}</span>
                                    </div>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                    <button className={TOOL_BUTTON_CLASS} type="button" onClick={openFullEditor}>
                                        <Edit3 className="h-3.5 w-3.5" />
                                        Edit
                                    </button>
                                    <button className={ICON_BUTTON_CLASS} type="button" onClick={duplicateMotion} title="Duplicate">
                                        <Copy className="h-4 w-4" />
                                    </button>
                                    <button className={ICON_BUTTON_CLASS} type="button" onClick={deleteMotion} title="Delete">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                            <div className="mb-2 text-xs font-medium text-slate-300">Tracks</div>
                            <TrackPills asset={selectedAsset} />
                        </section>

                        {actionContext && descriptor ? (
                            <section className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-xs font-medium text-primary">{descriptor.label}</div>
                                        <div className="mt-1 truncate text-[11px] text-slate-400">
                                            {actionAnimationId ? `Current action uses ${actionAnimationId}` : "Current action has no motion asset"}
                                        </div>
                                    </div>
                                    <button className={TOOL_BUTTON_CLASS} type="button" onClick={bindToAction}>
                                        <Check className="h-3.5 w-3.5" />
                                        Bind to action
                                    </button>
                                </div>
                            </section>
                        ) : null}
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

function TrackPills(props: { asset: StoryAnimationAsset }) {
    const tracks = props.asset.timeline?.tracks ?? [];
    if (tracks.length === 0) {
        return <div className="text-sm text-slate-500">No tracks yet. Open the editor to add animated properties.</div>;
    }
    return (
        <div className="flex flex-wrap gap-2">
            {tracks.map(track => {
                const meta = getStoryMotionPropertyMeta(track.property);
                return (
                    <span key={track.id} className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-300">
                        {meta.group} / {meta.label} · {track.keyframes.length}
                    </span>
                );
            })}
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

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function formatTargetKind(kind: StoryAnimationAsset["targetKind"]): string {
    return kind[0].toUpperCase() + kind.slice(1);
}
