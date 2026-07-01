import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Activity, Pause, Play, Plus, RotateCw, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type {
    StoryAlignPositionValue,
    StoryAnimationAsset,
    StoryAnimationKeyframe,
    StoryAnimationKeyframeValue,
    StoryAnimationTimeline,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
} from "@shared/types/story";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import type { EditorTabDefinition } from "../../registry/types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { getStoryMotionDescriptor } from "./storyMotionAction";
import type { StoryMotionEditorPayload } from "./storyMotionTypes";
import {
    STORY_MOTION_FPS,
    STORY_MOTION_PROPERTIES,
    STORY_MOTION_TEMPLATES,
    createStoryMotionTemplateTimeline,
    deleteStoryMotionKeyframe,
    ensureStoryMotionTrack,
    formatStoryMotionTime,
    getStoryMotionDurationMs,
    getStoryMotionPropertyMeta,
    getStoryMotionTimeline,
    sampleStoryMotionPreview,
    updateStoryMotionKeyframe,
    upsertStoryMotionKeyframe,
} from "./storyMotionTimeline";

const TOOL_BUTTON_CLASS = "inline-flex h-8 items-center gap-1.5 rounded border border-white/10 bg-white/[0.04] px-2 text-xs text-slate-200 hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";
const ICON_BUTTON_CLASS = "inline-grid h-8 w-8 place-items-center rounded border border-white/10 bg-white/[0.04] text-slate-300 hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";
const INPUT_CLASS = "h-8 rounded border border-white/10 bg-[#17191d] px-2 text-xs text-slate-200 outline-none focus:border-primary/50";
const ROW_HEIGHT = 34;
const MIN_TIMELINE_WIDTH = 760;

export function createStoryMotionEditorTab(payload: StoryMotionEditorPayload): EditorTabDefinition<StoryMotionEditorPayload> {
    return {
        id: `story-motion:${payload.animationId}`,
        title: "Story Motion",
        icon: <Activity className="h-4 w-4" />,
        component: StoryMotionEditorTab,
        payload,
        closable: true,
        modified: false,
    };
}

export function StoryMotionEditorTab({ payload }: EditorTabComponentProps<StoryMotionEditorPayload>) {
    const { context, isInitialized } = useWorkspace();
    const storyService = useMemo(
        () => context && isInitialized ? context.services.get<StoryService>(Services.Story) : null,
        [context, isInitialized],
    );
    const [asset, setAsset] = useState<StoryAnimationAsset | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [nameDraft, setNameDraft] = useState("");
    const [playheadMs, setPlayheadMs] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [autoKey, setAutoKey] = useState(true);
    const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
    const [selectedAddProperty, setSelectedAddProperty] = useState<StoryAnimationTrackProperty>("position");
    const [selectedTemplate, setSelectedTemplate] = useState<typeof STORY_MOTION_TEMPLATES[number]>("Fade in + slide");
    const [previewOverride, setPreviewOverride] = useState<Partial<ReturnType<typeof sampleStoryMotionPreview>> | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!storyService || !payload?.animationId) {
            setAsset(null);
            return;
        }
        let disposed = false;
        setLoadError(null);
        void storyService.loadAnimationAsset(payload.animationId)
            .then(next => {
                if (!disposed) {
                    setAsset(next);
                    setNameDraft(next.name);
                    setPlayheadMs(current => Math.min(current, getStoryMotionDurationMs(next.timeline)));
                }
            })
            .catch(error => {
                if (!disposed) {
                    setAsset(null);
                    setLoadError(error instanceof Error ? error.message : String(error));
                }
            });
        return () => {
            disposed = true;
        };
    }, [payload?.animationId, storyService]);

    useEffect(() => {
        setNameDraft(asset?.name ?? "");
    }, [asset?.name]);

    const timeline = useMemo(() => getStoryMotionTimeline(asset), [asset]);
    const durationMs = getStoryMotionDurationMs(timeline);
    const pxPerMs = 0.18 * zoom;
    const timelineWidth = Math.max(MIN_TIMELINE_WIDTH, durationMs * pxPerMs + 80);
    const tracks = useMemo(() => orderTracks(timeline.tracks), [timeline.tracks]);
    const selected = useMemo(() => findKeyframe(timeline, selectedKeyframeId), [selectedKeyframeId, timeline]);
    const preview = sampleStoryMotionPreview(timeline, playheadMs);
    const visiblePreview = previewOverride
        ? { ...preview, ...previewOverride, position: previewOverride.position ?? preview.position }
        : preview;

    useEffect(() => {
        if (!playing) {
            return;
        }
        const startedAt = performance.now() - playheadMs;
        const timer = window.setInterval(() => {
            const next = performance.now() - startedAt;
            if (next >= durationMs) {
                setPlayheadMs(durationMs);
                setPlaying(false);
                return;
            }
            setPlayheadMs(next);
        }, 16);
        return () => window.clearInterval(timer);
    }, [durationMs, playing, playheadMs]);

    const updateAsset = useCallback((updater: (asset: StoryAnimationAsset) => StoryAnimationAsset) => {
        if (!storyService || !asset) {
            return;
        }
        const next = storyService.updateAnimationAsset(asset.id, updater);
        setAsset(next);
    }, [asset, storyService]);

    const updateTimeline = useCallback((updater: (timeline: StoryAnimationTimeline) => StoryAnimationTimeline) => {
        updateAsset(current => ({
            ...current,
            timeline: updater(getStoryMotionTimeline(current)),
        }));
    }, [updateAsset]);

    const commitName = useCallback(() => {
        const nextName = nameDraft.trim();
        if (!nextName || !asset || nextName === asset.name) {
            setNameDraft(asset?.name ?? "");
            return;
        }
        updateAsset(current => ({ ...current, name: nextName }));
    }, [asset, nameDraft, updateAsset]);

    const applyToAction = useCallback(async () => {
        if (!storyService || !asset || !payload?.actionContext) {
            return;
        }
        const { storyId, sceneId, blockId } = payload.actionContext;
        const document = await storyService.loadStory(storyId);
        const block = document.scenes[sceneId]?.blocks[blockId];
        const descriptor = block ? getStoryMotionDescriptor(block) : null;
        if (!descriptor) {
            return;
        }
        storyService.updateBlock(storyId, sceneId, blockId, descriptor.setTransform({
            ...(descriptor.transform ?? {}),
            mode: "animation",
            animationId: asset.id,
        }));
    }, [asset, payload?.actionContext, storyService]);

    const scrubToClientX = useCallback((clientX: number, rect: DOMRect) => {
        const next = Math.max(0, Math.min(durationMs, (clientX - rect.left) / pxPerMs));
        setPlayheadMs(next);
    }, [durationMs, pxPerMs]);

    const startPlayheadDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        scrubToClientX(event.clientX, rect);
        const onMove = (moveEvent: PointerEvent) => scrubToClientX(moveEvent.clientX, rect);
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [scrubToClientX]);

    const startKeyframeDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, keyframe: StoryAnimationKeyframe) => {
        event.stopPropagation();
        setSelectedKeyframeId(keyframe.id);
        const startX = event.clientX;
        const startTime = keyframe.timeMs;
        const onMove = (moveEvent: PointerEvent) => {
            const nextTime = Math.max(0, Math.min(durationMs, Math.round(startTime + (moveEvent.clientX - startX) / pxPerMs)));
            updateTimeline(current => updateStoryMotionKeyframe(current, keyframe.id, currentKeyframe => ({
                ...currentKeyframe,
                timeMs: nextTime,
            })));
            setPlayheadMs(nextTime);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [durationMs, pxPerMs, updateTimeline]);

    const startPreviewDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, mode: "position" | "zoom" | "rotation") => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const startPreview = visiblePreview;
        let latestValue: StoryAnimationKeyframeValue | null = null;
        let latestProperty: StoryAnimationTrackProperty | null = null;
        const onMove = (moveEvent: PointerEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            if (mode === "position") {
                const position = {
                    ...startPreview.position,
                    xoffset: startPreview.position.xoffset + dx,
                    yoffset: startPreview.position.yoffset + dy,
                };
                latestProperty = "position";
                latestValue = position;
                setPreviewOverride({ position });
            } else if (mode === "zoom") {
                const zoomValue = Math.max(0.1, startPreview.zoom + dx / 180);
                latestProperty = "zoom";
                latestValue = Number(zoomValue.toFixed(3));
                setPreviewOverride({ zoom: zoomValue });
            } else {
                const rotation = startPreview.rotation + dx / 2;
                latestProperty = "rotation";
                latestValue = Number(rotation.toFixed(2));
                setPreviewOverride({ rotation });
            }
        };
        const onUp = () => {
            if (autoKey && latestProperty && latestValue !== null) {
                updateTimeline(current => upsertStoryMotionKeyframe(current, latestProperty!, playheadMs, latestValue!, "easeOut"));
            }
            setPreviewOverride(null);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [autoKey, playheadMs, updateTimeline, visiblePreview]);

    const targetStyle = useMemo<CSSProperties>(() => ({
        left: `calc(${visiblePreview.position.xalign * 100}% + ${visiblePreview.position.xoffset}px)`,
        top: `calc(${visiblePreview.position.yalign * 100}% + ${visiblePreview.position.yoffset}px)`,
        opacity: visiblePreview.opacity,
        transform: `translate(-50%, -50%) rotate(${visiblePreview.rotation}deg) scale(${visiblePreview.zoom * visiblePreview.scaleX}, ${visiblePreview.zoom * visiblePreview.scaleY})`,
        filter: visiblePreview.filter,
        clipPath: visiblePreview.clipPath,
        mixBlendMode: visiblePreview.mixBlendMode as CSSProperties["mixBlendMode"],
    }), [visiblePreview]);

    if (!asset) {
        return (
            <div className="flex h-full items-center justify-center bg-[#101114] text-sm text-slate-400">
                {loadError ?? "Loading motion asset..."}
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#101114] text-slate-200">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3">
                <Activity className="h-4 w-4 text-primary" />
                <input
                    className={`${INPUT_CLASS} w-56 font-medium`}
                    value={nameDraft}
                    onChange={event => setNameDraft(event.target.value)}
                    onBlur={commitName}
                    onKeyDown={event => {
                        if (event.key === "Enter") {
                            event.currentTarget.blur();
                        }
                    }}
                />
                <select
                    className={INPUT_CLASS}
                    value={asset.targetKind}
                    onChange={event => updateAsset(current => ({ ...current, targetKind: event.target.value as StoryAnimationAsset["targetKind"] }))}
                >
                    <option value="image">Image</option>
                    <option value="text">Text</option>
                    <option value="layer">Layer</option>
                    <option value="character">Character</option>
                </select>
                <select className={`${INPUT_CLASS} w-36`} value={selectedTemplate} onChange={event => setSelectedTemplate(event.target.value as typeof STORY_MOTION_TEMPLATES[number])}>
                    {STORY_MOTION_TEMPLATES.map(template => (
                        <option key={template} value={template}>{template}</option>
                    ))}
                </select>
                <button className={TOOL_BUTTON_CLASS} type="button" onClick={() => updateTimeline(() => createStoryMotionTemplateTimeline(selectedTemplate))}>
                    Template
                </button>
                <NumberInput
                    className="w-24"
                    value={durationMs}
                    min={0}
                    onChange={value => updateTimeline(current => ({ ...current, durationMs: value }))}
                />
                <button className={ICON_BUTTON_CLASS} type="button" onClick={() => setPlaying(value => !value)} title={playing ? "Pause" : "Play"}>
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <input
                    className="h-1.5 flex-1 accent-primary"
                    type="range"
                    min={0}
                    max={durationMs}
                    value={Math.min(playheadMs, durationMs)}
                    onChange={event => setPlayheadMs(Number(event.target.value))}
                />
                <div className="w-24 text-xs tabular-nums text-slate-400">{formatStoryMotionTime(playheadMs, timeline.fps ?? STORY_MOTION_FPS)}</div>
                <button className={ICON_BUTTON_CLASS} type="button" onClick={() => setZoom(value => Math.max(0.45, value - 0.15))} title="Zoom out">
                    <ZoomOut className="h-4 w-4" />
                </button>
                <button className={ICON_BUTTON_CLASS} type="button" onClick={() => setZoom(value => Math.min(2.4, value + 0.15))} title="Zoom in">
                    <ZoomIn className="h-4 w-4" />
                </button>
                <label className="inline-flex h-8 items-center gap-2 rounded border border-white/10 bg-white/[0.04] px-2 text-xs text-slate-300">
                    <input type="checkbox" checked={autoKey} onChange={event => setAutoKey(event.target.checked)} />
                    Auto-key
                </label>
                {payload?.actionContext ? (
                    <button className={TOOL_BUTTON_CLASS} type="button" onClick={applyToAction}>
                        Apply to action
                    </button>
                ) : null}
            </div>

            <div className={selected ? "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px]" : "grid min-h-0 flex-1 grid-cols-1"}>
                <div className="flex min-h-0 flex-col">
                    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#15171b]" ref={previewRef}>
                        <div className="absolute inset-6 rounded border border-white/10 bg-[linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px)] bg-[length:32px_32px]" />
                        <div
                            className="absolute grid h-40 w-28 cursor-move place-items-center rounded border border-primary/40 bg-primary/15 text-xs font-medium text-primary shadow-[0_12px_40px_rgba(0,0,0,.28)]"
                            style={targetStyle}
                            onPointerDown={event => startPreviewDrag(event, "position")}
                        >
                            {asset.targetKind}
                            <div
                                className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded border border-white/70 bg-primary"
                                onPointerDown={event => startPreviewDrag(event, "zoom")}
                                title="Drag to scale"
                            />
                            <div
                                className="absolute -top-7 left-1/2 grid h-5 w-5 -translate-x-1/2 cursor-ew-resize place-items-center rounded-full border border-white/50 bg-[#1b1d22] text-slate-200"
                                onPointerDown={event => startPreviewDrag(event, "rotation")}
                                title="Drag to rotate"
                            >
                                <RotateCw className="h-3 w-3" />
                            </div>
                        </div>
                    </div>

                    <div className="h-64 shrink-0 border-t border-white/10 bg-[#0f1013]">
                        <div className="flex h-9 items-center gap-2 border-b border-white/10 px-3">
                            <div className="w-[168px] text-xs font-medium text-slate-300">Target layer</div>
                            <select
                                className={`${INPUT_CLASS} w-40`}
                                value={selectedAddProperty}
                                onChange={event => setSelectedAddProperty(event.target.value as StoryAnimationTrackProperty)}
                            >
                                {STORY_MOTION_PROPERTIES.filter(item => !tracks.some(track => track.property === item.property)).map(item => (
                                    <option key={item.property} value={item.property}>{item.label}</option>
                                ))}
                            </select>
                            <button className={TOOL_BUTTON_CLASS} type="button" onClick={() => updateTimeline(current => ensureStoryMotionTrack(current, selectedAddProperty))}>
                                <Plus className="h-3.5 w-3.5" />
                                Add property
                            </button>
                        </div>
                        <div className="grid h-[calc(100%-36px)] grid-cols-[180px_minmax(0,1fr)] overflow-hidden">
                            <div className="border-r border-white/10">
                                <div className="flex h-8 items-center border-b border-white/10 px-3 text-xs font-medium text-slate-300">Layer 1</div>
                                {tracks.map(track => (
                                    <div key={track.id} className="flex h-[34px] items-center border-b border-white/[0.06] px-5 text-xs text-slate-400">
                                        {getStoryMotionPropertyMeta(track.property).label}
                                    </div>
                                ))}
                            </div>
                            <div className="overflow-auto">
                                <div style={{ width: timelineWidth }}>
                                    <div
                                        className="relative h-8 border-b border-white/10"
                                        onPointerDown={startPlayheadDrag}
                                    >
                                        {buildTicks(durationMs, zoom, timeline.fps ?? STORY_MOTION_FPS).map(tick => (
                                            <div key={tick.timeMs} className="absolute top-0 h-full border-l border-white/10" style={{ left: tick.timeMs * pxPerMs }}>
                                                <span className="ml-1 text-[10px] text-slate-500">{tick.label}</span>
                                            </div>
                                        ))}
                                        <div className="absolute top-0 z-20 h-full w-px bg-orange-400" style={{ left: playheadMs * pxPerMs }}>
                                            <div className="-ml-1.5 h-3 w-3 rounded-sm bg-orange-400 rotate-45" />
                                        </div>
                                    </div>
                                    <div className="relative" style={{ height: tracks.length * ROW_HEIGHT }}>
                                        <div className="absolute top-0 z-20 w-px bg-orange-400/90" style={{ left: playheadMs * pxPerMs, height: tracks.length * ROW_HEIGHT }} />
                                        {tracks.map((track, rowIndex) => (
                                            <div key={track.id} className="relative h-[34px] border-b border-white/[0.06]">
                                                {track.keyframes.map(keyframe => (
                                                    <button
                                                        key={keyframe.id}
                                                        type="button"
                                                        className={[
                                                            "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border",
                                                            selectedKeyframeId === keyframe.id
                                                                ? "border-orange-300 bg-orange-400"
                                                                : "border-primary/80 bg-[#1f9eff]",
                                                        ].join(" ")}
                                                        style={{ left: keyframe.timeMs * pxPerMs }}
                                                        onClick={() => setSelectedKeyframeId(keyframe.id)}
                                                        onPointerDown={event => startKeyframeDrag(event, keyframe)}
                                                        title={`${getStoryMotionPropertyMeta(track.property).label} ${formatStoryMotionTime(keyframe.timeMs, timeline.fps ?? STORY_MOTION_FPS)}`}
                                                    />
                                                ))}
                                                <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-white/[0.04]" />
                                                <div className="sr-only">{rowIndex}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {selected ? (
                    <aside className="min-h-0 border-l border-white/10 bg-[#121419]">
                        <KeyframeInspector
                            track={selected.track}
                            keyframe={selected.keyframe}
                            onChange={patch => updateTimeline(current => updateStoryMotionKeyframe(current, selected.keyframe.id, keyframe => ({ ...keyframe, ...patch })))}
                            onDelete={() => {
                                updateTimeline(current => deleteStoryMotionKeyframe(current, selected.keyframe.id));
                                setSelectedKeyframeId(null);
                            }}
                        />
                    </aside>
                ) : null}
            </div>
        </div>
    );
}

function KeyframeInspector(props: {
    track: StoryAnimationTrack;
    keyframe: StoryAnimationKeyframe;
    onChange: (patch: Partial<StoryAnimationKeyframe>) => void;
    onDelete: () => void;
}) {
    const meta = getStoryMotionPropertyMeta(props.track.property);
    return (
        <div className="p-3">
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <div className="text-xs font-medium text-slate-200">{meta.label}</div>
                    <div className="text-[11px] text-slate-500">Keyframe</div>
                </div>
                <button className={ICON_BUTTON_CLASS} type="button" onClick={props.onDelete} title="Delete keyframe">
                    <Trash2 className="h-4 w-4" />
                </button>
            </div>
            <div className="grid gap-3">
                <LabeledNumber label="Time ms" value={props.keyframe.timeMs} min={0} onChange={timeMs => props.onChange({ timeMs })} />
                <label className="grid gap-1">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Easing</span>
                    <select className={INPUT_CLASS} value={props.keyframe.easing ?? ""} onChange={event => props.onChange({ easing: event.target.value || undefined })}>
                        <option value="">Default</option>
                        <option value="linear">Linear</option>
                        <option value="easeIn">Ease in</option>
                        <option value="easeOut">Ease out</option>
                        <option value="easeInOut">Ease in out</option>
                        <option value="backOut">Back out</option>
                    </select>
                </label>
                <ValueEditor property={props.track.property} value={props.keyframe.value} onChange={value => props.onChange({ value })} />
            </div>
        </div>
    );
}

function ValueEditor(props: {
    property: StoryAnimationTrackProperty;
    value: StoryAnimationKeyframeValue;
    onChange: (value: StoryAnimationKeyframeValue) => void;
}) {
    const meta = getStoryMotionPropertyMeta(props.property);
    if (meta.valueKind === "position") {
        const value = typeof props.value === "object" ? props.value : {};
        const updatePosition = (patch: Partial<StoryAlignPositionValue>) => props.onChange({ ...value, ...patch });
        return (
            <div className="grid grid-cols-2 gap-2">
                <LabeledNumber label="X align" value={value.xalign ?? 0.5} step={0.01} onChange={xalign => updatePosition({ xalign })} />
                <LabeledNumber label="Y align" value={value.yalign ?? 0.55} step={0.01} onChange={yalign => updatePosition({ yalign })} />
                <LabeledNumber label="X offset" value={value.xoffset ?? 0} onChange={xoffset => updatePosition({ xoffset })} />
                <LabeledNumber label="Y offset" value={value.yoffset ?? 0} onChange={yoffset => updatePosition({ yoffset })} />
            </div>
        );
    }
    if (meta.valueKind === "number") {
        return <LabeledNumber label="Value" value={typeof props.value === "number" ? props.value : 0} step={0.01} onChange={props.onChange} />;
    }
    return (
        <label className="grid gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Value</span>
            <input className={INPUT_CLASS} value={typeof props.value === "string" ? props.value : ""} onChange={event => props.onChange(event.target.value)} />
        </label>
    );
}

function LabeledNumber(props: { label: string; value: number; min?: number; step?: number; onChange: (value: number) => void }) {
    return (
        <label className="grid gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{props.label}</span>
            <NumberInput value={props.value} min={props.min} step={props.step} onChange={props.onChange} />
        </label>
    );
}

function NumberInput(props: {
    value: number;
    min?: number;
    step?: number;
    className?: string;
    onChange: (value: number) => void;
}) {
    return (
        <input
            className={`${INPUT_CLASS} ${props.className ?? ""}`}
            type="number"
            inputMode="decimal"
            min={props.min}
            step={props.step ?? 1}
            value={Number.isFinite(props.value) ? props.value : 0}
            onChange={event => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) {
                    props.onChange(next);
                }
            }}
        />
    );
}

function findKeyframe(timeline: StoryAnimationTimeline, keyframeId: string | null): { track: StoryAnimationTrack; keyframe: StoryAnimationKeyframe } | null {
    if (!keyframeId) {
        return null;
    }
    for (const track of timeline.tracks) {
        const keyframe = track.keyframes.find(item => item.id === keyframeId);
        if (keyframe) {
            return { track, keyframe };
        }
    }
    return null;
}

function orderTracks(tracks: StoryAnimationTrack[]): StoryAnimationTrack[] {
    return [...tracks].sort((a, b) => {
        const left = STORY_MOTION_PROPERTIES.findIndex(item => item.property === a.property);
        const right = STORY_MOTION_PROPERTIES.findIndex(item => item.property === b.property);
        return left - right || a.id.localeCompare(b.id);
    });
}

function buildTicks(durationMs: number, zoom: number, fps: number): { timeMs: number; label: string }[] {
    const step = zoom > 1.5 ? 100 : zoom > 0.85 ? 250 : 500;
    const ticks: { timeMs: number; label: string }[] = [];
    for (let timeMs = 0; timeMs <= durationMs + step; timeMs += step) {
        const clamped = Math.min(durationMs, timeMs);
        const frame = Math.round((clamped / 1000) * fps);
        ticks.push({
            timeMs: clamped,
            label: `${(clamped / 1000).toFixed(clamped % 1000 === 0 ? 0 : 2)}s f${frame}`,
        });
        if (clamped === durationMs) {
            break;
        }
    }
    return ticks;
}
