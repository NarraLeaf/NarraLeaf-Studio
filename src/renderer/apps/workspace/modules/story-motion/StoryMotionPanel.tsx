import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Activity, Check, Copy, Edit3, Pause, Play, Plus, Search, Trash2 } from "lucide-react";
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
    STORY_MOTION_FPS,
    STORY_MOTION_TEMPLATES,
    createStoryMotionName,
    createStoryMotionTemplateTimeline,
    formatStoryMotionTime,
    getStoryMotionDurationMs,
    getStoryMotionPropertyMeta,
    sampleStoryMotionPreview,
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
    const [playheadMs, setPlayheadMs] = useState(0);
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        if (!storyService) {
            setAssets([]);
            return;
        }
        const refresh = () => setAssets(storyService.listAnimationAssets());
        refresh();
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
                if (!disposed) setDocument(next);
            })
            .catch(() => {
                if (!disposed) setDocument(null);
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
                    setPlayheadMs(current => Math.min(current, getStoryMotionDurationMs(asset.timeline)));
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
        return assets.filter(asset => !needle || asset.name.toLowerCase().includes(needle) || asset.id.toLowerCase().includes(needle));
    }, [assets, query]);

    const durationMs = selectedAsset ? getStoryMotionDurationMs(selectedAsset.timeline) : 0;
    const preview = selectedAsset ? sampleStoryMotionPreview(selectedAsset.timeline, playheadMs) : null;

    useEffect(() => {
        if (!playing || !selectedAsset) {
            return;
        }
        const startedAt = performance.now() - playheadMs;
        const timer = window.setInterval(() => {
            const next = performance.now() - startedAt;
            if (next >= durationMs) {
                setPlayheadMs(0);
                setPlaying(false);
                return;
            }
            setPlayheadMs(next);
        }, 16);
        return () => window.clearInterval(timer);
    }, [durationMs, playing, playheadMs, selectedAsset]);

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
            timeline: clone(selectedAsset.timeline),
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

    const applyToSelectedAction = useCallback(() => {
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

    const previewStyle = useMemo<CSSProperties>(() => preview ? ({
        left: `calc(${preview.position.xalign * 100}% + ${preview.position.xoffset * 0.45}px)`,
        top: `calc(${preview.position.yalign * 100}% + ${preview.position.yoffset * 0.45}px)`,
        opacity: preview.opacity,
        transform: `translate(-50%, -50%) rotate(${preview.rotation}deg) scale(${preview.zoom * preview.scaleX}, ${preview.zoom * preview.scaleY})`,
        filter: preview.filter,
        clipPath: preview.clipPath,
        mixBlendMode: preview.mixBlendMode as CSSProperties["mixBlendMode"],
    }) : {}, [preview]);

    return (
        <div className="flex h-full min-h-0 bg-[#101114] text-slate-200">
            <aside className="flex w-80 shrink-0 flex-col border-r border-white/10">
                <div className="flex h-10 items-center gap-2 border-b border-white/10 px-3">
                    <Activity className="h-4 w-4 text-primary" />
                    <div className="min-w-0 flex-1 text-sm font-medium">Project Motions</div>
                    <button className={ICON_BUTTON_CLASS} type="button" onClick={createMotion} title="Create motion">
                        <Plus className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex items-center gap-2 border-b border-white/10 p-2">
                    <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                        <input
                            className={`${INPUT_CLASS} w-full pl-7`}
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder="Search motions"
                        />
                    </div>
                    <select className={`${INPUT_CLASS} w-36`} value={template} onChange={event => setTemplate(event.target.value as typeof STORY_MOTION_TEMPLATES[number])}>
                        {STORY_MOTION_TEMPLATES.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                    {filteredAssets.length === 0 ? (
                        <div className="p-4 text-sm text-slate-500">No motion assets yet.</div>
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
                                <span className="block truncate text-[11px] text-slate-500">{asset.targetKind} · {asset.id}</span>
                            </span>
                            {actionAnimationId === asset.id ? <Check className="h-4 w-4 text-primary" /> : null}
                        </button>
                    ))}
                </div>
            </aside>

            <main className="grid min-w-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
                <section className="border-r border-white/10 p-3">
                    <div className="mb-3 flex items-center gap-2">
                        <input
                            className={`${INPUT_CLASS} min-w-0 flex-1 font-medium`}
                            value={renameDraft}
                            disabled={!selectedAsset}
                            onChange={event => setRenameDraft(event.target.value)}
                            onBlur={commitRename}
                            onKeyDown={event => {
                                if (event.key === "Enter") event.currentTarget.blur();
                            }}
                        />
                        <button className={ICON_BUTTON_CLASS} type="button" disabled={!selectedAsset} onClick={openFullEditor} title="Open full editor">
                            <Edit3 className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="relative h-40 overflow-hidden rounded border border-white/10 bg-[#15171b]">
                        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px)] bg-[length:24px_24px]" />
                        {selectedAsset && preview ? (
                            <div className="absolute grid h-20 w-14 place-items-center rounded border border-primary/40 bg-primary/15 text-[10px] font-medium text-primary" style={previewStyle}>
                                {selectedAsset.targetKind}
                            </div>
                        ) : null}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                        <button className={ICON_BUTTON_CLASS} type="button" disabled={!selectedAsset} onClick={() => setPlaying(value => !value)} title={playing ? "Pause" : "Play"}>
                            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </button>
                        <input
                            className="h-1.5 min-w-0 flex-1 accent-primary"
                            type="range"
                            min={0}
                            max={durationMs || 1}
                            value={Math.min(playheadMs, durationMs || 1)}
                            disabled={!selectedAsset}
                            onChange={event => setPlayheadMs(Number(event.target.value))}
                        />
                        <div className="w-20 text-right text-[11px] tabular-nums text-slate-500">{formatStoryMotionTime(playheadMs, selectedAsset?.timeline?.fps ?? STORY_MOTION_FPS)}</div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <button className={TOOL_BUTTON_CLASS} type="button" disabled={!selectedAsset} onClick={openFullEditor}>Open editor</button>
                        <button className={TOOL_BUTTON_CLASS} type="button" disabled={!selectedAsset} onClick={duplicateMotion}>
                            <Copy className="h-3.5 w-3.5" />
                            Duplicate
                        </button>
                        <button className={TOOL_BUTTON_CLASS} type="button" disabled={!selectedAsset} onClick={deleteMotion}>
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                        </button>
                    </div>
                    {actionContext && descriptor ? (
                        <div className="mt-4 rounded border border-primary/20 bg-primary/10 p-2">
                            <div className="truncate text-xs font-medium text-primary">{descriptor.label}</div>
                            <div className="mt-1 truncate text-[11px] text-slate-400">
                                {actionAnimationId ? `Using ${actionAnimationId}` : "Selected action has no motion asset"}
                            </div>
                            <button className={`${TOOL_BUTTON_CLASS} mt-2 w-full justify-center`} type="button" disabled={!selectedAsset} onClick={applyToSelectedAction}>
                                Apply to selected action
                            </button>
                        </div>
                    ) : (
                        <div className="mt-4 rounded border border-white/10 bg-white/[0.025] p-2 text-xs text-slate-500">
                            No Story action focus required. Select a motion to edit or preview.
                        </div>
                    )}
                </section>

                <section className="min-w-0 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs font-medium text-slate-300">Timeline</div>
                        <div className="text-[11px] text-slate-500">{selectedAsset ? `${durationMs}ms · ${selectedAsset.timeline?.fps ?? STORY_MOTION_FPS}fps` : "No motion selected"}</div>
                    </div>
                    <div className="overflow-auto rounded border border-white/10 bg-[#0f1013]">
                        {selectedAsset ? <MiniTimeline asset={selectedAsset} playheadMs={playheadMs} /> : (
                            <div className="p-6 text-sm text-slate-500">Create a motion from a template to start.</div>
                        )}
                    </div>
                </section>
            </main>
        </div>
    );
}

function MiniTimeline(props: { asset: StoryAnimationAsset; playheadMs: number }) {
    const durationMs = getStoryMotionDurationMs(props.asset.timeline);
    const pxPerMs = 0.12;
    const width = Math.max(560, durationMs * pxPerMs + 60);
    const tracks = [...(props.asset.timeline?.tracks ?? [])].sort((a, b) => getStoryMotionPropertyMeta(a.property).label.localeCompare(getStoryMotionPropertyMeta(b.property).label));
    return (
        <div className="grid min-h-48 grid-cols-[140px_minmax(0,1fr)]">
            <div className="border-r border-white/10">
                <div className="h-8 border-b border-white/10 px-3 py-2 text-xs text-slate-400">Layer 1</div>
                {tracks.map(track => (
                    <div key={track.id} className="h-8 border-b border-white/[0.06] px-4 py-2 text-xs text-slate-500">
                        {getStoryMotionPropertyMeta(track.property).label}
                    </div>
                ))}
            </div>
            <div className="overflow-x-auto">
                <div className="relative" style={{ width }}>
                    <div className="h-8 border-b border-white/10">
                        {buildMiniTicks(durationMs).map(tick => (
                            <div key={tick} className="absolute top-0 h-full border-l border-white/10 text-[10px] text-slate-600" style={{ left: tick * pxPerMs }}>
                                <span className="ml-1">{(tick / 1000).toFixed(tick % 1000 === 0 ? 0 : 1)}s</span>
                            </div>
                        ))}
                    </div>
                    <div className="absolute top-0 z-10 w-px bg-orange-400" style={{ left: props.playheadMs * pxPerMs, height: 32 + tracks.length * 32 }} />
                    {tracks.map(track => (
                        <div key={track.id} className="relative h-8 border-b border-white/[0.06]">
                            {track.keyframes.map(keyframe => (
                                <span
                                    key={keyframe.id}
                                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-primary/80 bg-[#1f9eff]"
                                    style={{ left: keyframe.timeMs * pxPerMs }}
                                    title={`${getStoryMotionPropertyMeta(track.property).label} ${keyframe.timeMs}ms`}
                                />
                            ))}
                            <span className="absolute inset-x-0 top-1/2 border-t border-white/[0.04]" />
                        </div>
                    ))}
                </div>
            </div>
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

function buildMiniTicks(durationMs: number): number[] {
    const ticks: number[] = [];
    for (let timeMs = 0; timeMs <= durationMs + 500; timeMs += 500) {
        ticks.push(Math.min(timeMs, durationMs));
        if (timeMs >= durationMs) break;
    }
    return [...new Set(ticks)];
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
