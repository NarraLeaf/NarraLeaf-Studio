import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, Edit3, Plus, Search, Spline, X } from "lucide-react";
import type {
    StoryAnimationAsset,
    StoryAnimationIndexEntry,
    StoryDisplayableTargetKind,
    StoryDocument,
    StoryTransformRef,
} from "@shared/types/story";
import { formatStorySecondsLabel } from "@shared/utils/storyTime";
import { useTranslation, type UseTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { Select } from "@/lib/components/elements/Select";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { createStoryMotionEditorTab, resolveStoryMotionStageSize } from "./StoryMotionEditorTab";
import { resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";
import { StoryMotionStagePreview } from "./StoryMotionStagePreview";
import type { StoryMotionActionContext } from "./storyMotionTypes";
import {
    STORY_MOTION_TEMPLATES,
    createStoryMotionName,
    createStoryMotionTemplateTimeline,
    getStoryMotionDurationMs,
    getStoryMotionPropertyMeta,
    sampleStoryMotionPreview,
    type StoryMotionTemplateName,
} from "./storyMotionTimeline";

const WINDOW_TITLEBAR_HEIGHT = 40;
const HOVER_DELAY_MS = 340;
const PREVIEW_BOX = { width: 300, height: 176 };
const PREVIEW_GAP = 12;
const PREVIEW_LOOP_GAP_MS = 1100;
const PREVIEW_FRAME_MS = 1000 / 30;

const ICON_BUTTON_CLASS = controlButtonClass();
const TOOL_BUTTON_CLASS = "inline-flex h-8 items-center gap-1.5 rounded border border-edge bg-fill-subtle px-2 text-xs text-fg hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";

const STORY_MOTION_TEMPLATE_KEYS = {
    "Fade in + slide": "fadeInSlide",
    "Center pop": "centerPop",
    "Look around": "lookAround",
    "Flash": "flash",
} as const satisfies Record<StoryMotionTemplateName, string>;

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function motionSummary(asset: StoryAnimationAsset, t: UseTranslation["t"]): string {
    const duration = formatStorySecondsLabel(getStoryMotionDurationMs(asset.timeline));
    const tracks = asset.timeline?.tracks ?? [];
    const labels = tracks
        .slice(0, 3)
        .map(track => t(`motion.propertyLabel.${track.property}`))
        .join(", ");
    return `${duration}${labels ? ` / ${labels}${tracks.length > 3 ? "..." : ""}` : ""}`;
}

/**
 * Anchored portal picker for Story Motion assets, modelled on the project asset selector.
 * Lists the animation assets for the current target kind and renders a live, looping motion
 * preview when a row is hovered (via {@link StoryMotionStagePreview}).
 */
export function MotionSelector(props: {
    visible: boolean;
    value: string | undefined;
    targetKind: StoryDisplayableTargetKind;
    actionContext: StoryMotionActionContext;
    anchorRef: RefObject<HTMLElement | null>;
    onClose: () => void;
    onSelect: (animationId: string) => void;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const storyService = useMemo(
        () => context && isInitialized ? context.services.get<StoryService>(Services.Story) : null,
        [context, isInitialized],
    );
    const projectService = useMemo(
        () => context && isInitialized ? context.services.get<ProjectService>(Services.Project) : null,
        [context, isInitialized],
    );

    const [assets, setAssets] = useState<StoryAnimationIndexEntry[]>([]);
    const [query, setQuery] = useState("");
    const [template, setTemplate] = useState<typeof STORY_MOTION_TEMPLATES[number]>("Fade in + slide");
    const [hovered, setHovered] = useState<{ id: string; top: number; left: number } | null>(null);
    const [anchorStyle, setAnchorStyle] = useState({ top: 0, left: 0, width: 360 });
    const panelRef = useRef<HTMLDivElement | null>(null);
    const hoverTimer = useRef<number | null>(null);

    const templateOptions = useMemo(
        () => STORY_MOTION_TEMPLATES.map(option => ({
            value: option,
            label: t(`motion.templates.${STORY_MOTION_TEMPLATE_KEYS[option]}`),
        })),
        [t],
    );

    useEffect(() => {
        if (!storyService || !props.visible) {
            return;
        }
        setAssets([...storyService.listAnimationAssets()]);
        return storyService.onAnimationsChanged(index => setAssets([...index.animations]));
    }, [storyService, props.visible]);

    useEffect(() => {
        if (!props.visible) {
            return;
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                props.onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [props.visible, props]);

    useEffect(() => () => {
        if (hoverTimer.current !== null) {
            window.clearTimeout(hoverTimer.current);
        }
    }, []);

    useLayoutEffect(() => {
        if (!props.visible) {
            return;
        }
        const viewportMargin = 12;
        const viewportTop = WINDOW_TITLEBAR_HEIGHT + viewportMargin;
        const maxPanelHeight = 420;
        const updatePosition = () => {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const panelHeight = Math.min(panelRef.current?.offsetHeight ?? maxPanelHeight, maxPanelHeight);
            const anchor = props.anchorRef.current;
            if (!anchor) {
                return;
            }
            const rect = anchor.getBoundingClientRect();
            const width = clamp(rect.width, 320, 460);
            const availableBelow = viewportHeight - rect.bottom - viewportMargin;
            const availableAbove = rect.top - viewportTop;
            const openDown = availableBelow >= panelHeight || availableBelow >= availableAbove;
            let top = openDown ? rect.bottom + 8 : rect.top - panelHeight - 8;
            top = clamp(top, viewportTop, Math.max(viewportTop, viewportHeight - viewportMargin - panelHeight));
            const left = clamp(rect.left, viewportMargin, viewportWidth - viewportMargin - width);
            setAnchorStyle({ top, left, width });
        };
        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, { passive: true });
        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition);
        };
    }, [props.anchorRef, props.visible, assets.length]);

    const filteredAssets = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return assets
            .filter(asset => asset.targetKind === props.targetKind)
            .filter(asset => !needle
                || asset.name.toLowerCase().includes(needle)
                || asset.id.toLowerCase().includes(needle));
    }, [assets, props.targetKind, query]);

    const scheduleHover = useCallback((assetId: string, element: HTMLElement) => {
        if (hoverTimer.current !== null) {
            window.clearTimeout(hoverTimer.current);
        }
        hoverTimer.current = window.setTimeout(() => {
            const rect = element.getBoundingClientRect();
            let left = rect.right + PREVIEW_GAP;
            if (left + PREVIEW_BOX.width > window.innerWidth - PREVIEW_GAP) {
                left = rect.left - PREVIEW_BOX.width - PREVIEW_GAP;
            }
            left = clamp(left, PREVIEW_GAP, window.innerWidth - PREVIEW_GAP - PREVIEW_BOX.width);
            const top = clamp(
                rect.top + rect.height / 2 - PREVIEW_BOX.height / 2,
                WINDOW_TITLEBAR_HEIGHT + PREVIEW_GAP,
                window.innerHeight - PREVIEW_GAP - PREVIEW_BOX.height,
            );
            setHovered({ id: assetId, top, left });
        }, HOVER_DELAY_MS);
    }, []);

    const clearHover = useCallback(() => {
        if (hoverTimer.current !== null) {
            window.clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
        }
        setHovered(null);
    }, []);

    const createAndBind = useCallback(async () => {
        if (!storyService) {
            return;
        }
        const asset = await storyService.createAnimationAsset({
            name: createStoryMotionName(props.targetKind, template),
            targetKind: props.targetKind,
            timeline: createStoryMotionTemplateTimeline(template),
        });
        props.onSelect(asset.id);
    }, [props, storyService, template]);

    const openEditor = useCallback((assetId: string) => {
        openEditorTab(createStoryMotionEditorTab({ animationId: assetId, actionContext: props.actionContext }));
    }, [openEditorTab, props.actionContext]);

    if (!props.visible) {
        return null;
    }

    const panel = (
        <div
            className="fixed inset-0 z-[60]"
            onMouseDown={event => {
                if (event.target === event.currentTarget) {
                    props.onClose();
                }
            }}
        >
            <div
                ref={panelRef}
                style={{ position: "fixed", top: anchorStyle.top, left: anchorStyle.left, width: anchorStyle.width }}
                className="flex max-h-[420px] flex-col overflow-hidden rounded-lg border border-edge-strong bg-surface-overlay shadow-2xl"
                onMouseDown={event => event.stopPropagation()}
            >
                <div className="flex items-center gap-2 border-b border-edge p-2">
                    <EnhancedInput
                        className="flex-1"
                        value={query}
                        onChange={setQuery}
                        placeholder={t("motion.searchStoryMotions")}
                        leftIcon={<Search className="h-3.5 w-3.5 text-fg-subtle" />}
                    />
                    <Select
                        className="w-40"
                        size="sm"
                        options={templateOptions}
                        value={template}
                        onChange={value => setTemplate(value as typeof STORY_MOTION_TEMPLATES[number])}
                        portalMenu
                        menuZIndex={90}
                    />
                    <button className={TOOL_BUTTON_CLASS} type="button" onClick={createAndBind} disabled={!storyService}>
                        <Plus className="h-3.5 w-3.5" />
                        {t("common.new")}
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-1">
                    {filteredAssets.length === 0 ? (
                        <div className="p-6 text-center text-xs text-fg-subtle">
                            {t("motion.selector.emptyKind", { kind: t(`motion.targetKind.${props.targetKind}`).toLowerCase() })}
                        </div>
                    ) : filteredAssets.map(asset => {
                        const selected = props.value === asset.id;
                        return (
                            <div
                                key={asset.id}
                                className={[
                                    "group flex items-center gap-2 rounded-md px-2 py-2 transition-colors",
                                    selected ? "bg-primary/20 ring-1 ring-inset ring-primary/50" : "hover:bg-fill-subtle",
                                ].join(" ")}
                                onMouseEnter={event => scheduleHover(asset.id, event.currentTarget)}
                                onMouseLeave={clearHover}
                            >
                                <button
                                    type="button"
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                    onClick={() => props.onSelect(asset.id)}
                                >
                                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-edge bg-fill-subtle text-primary">
                                        <Spline className="h-3.5 w-3.5" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-medium text-fg">{asset.name}</span>
                                        <span className="block truncate text-2xs text-fg-subtle">{t(`motion.targetKind.${asset.targetKind}`)}</span>
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className={`${ICON_BUTTON_CLASS} opacity-0 group-hover:opacity-100`}
                                    onClick={() => openEditor(asset.id)}
                                    title={t("motion.editMotion")}
                                >
                                    <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );

    return createPortal(
        <>
            {panel}
            {hovered && storyService ? (
                <MotionHoverPreview
                    animationId={hovered.id}
                    position={{ top: hovered.top, left: hovered.left }}
                    storyService={storyService}
                    projectService={projectService}
                    actionContext={props.actionContext}
                    fallbackKind={props.targetKind}
                />
            ) : null}
        </>,
        document.body,
    );
}

function MotionHoverPreview(props: {
    animationId: string;
    position: { top: number; left: number };
    storyService: StoryService;
    projectService: ProjectService | null;
    actionContext: StoryMotionActionContext;
    fallbackKind: StoryDisplayableTargetKind;
}) {
    const { t } = useTranslation();
    const [asset, setAsset] = useState<StoryAnimationAsset | null>(null);
    const [timeMs, setTimeMs] = useState(0);

    useEffect(() => {
        let disposed = false;
        setAsset(null);
        void props.storyService.loadAnimationAsset(props.animationId)
            .then(loaded => { if (!disposed) setAsset(loaded); })
            .catch(() => { if (!disposed) setAsset(null); });
        return () => { disposed = true; };
    }, [props.animationId, props.storyService]);

    const timeline = asset?.timeline;
    const durationMs = useMemo(() => getStoryMotionDurationMs(timeline), [timeline]);

    useEffect(() => {
        if (!asset) {
            setTimeMs(0);
            return;
        }
        let frame = 0;
        let startedAt: number | null = null;
        let lastPaint = 0;
        const duration = Math.max(1, durationMs);
        const cycle = duration + PREVIEW_LOOP_GAP_MS;
        const tick = (time: number) => {
            if (startedAt === null) {
                startedAt = time;
            }
            if (lastPaint === 0 || time - lastPaint >= PREVIEW_FRAME_MS) {
                const elapsed = (time - startedAt) % cycle;
                setTimeMs(Math.round(Math.min(elapsed, duration)));
                lastPaint = time;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [asset, durationMs]);

    const preview = useMemo(() => sampleStoryMotionPreview(timeline, timeMs), [timeline, timeMs]);
    const stageSize = useMemo(() => resolveStoryMotionStageSize(props.projectService), [props.projectService]);
    const document = useMemo<StoryDocument | null>(() => {
        try {
            return props.storyService.getStoryDocument(props.actionContext.storyId);
        } catch {
            return null;
        }
    }, [props.storyService, props.actionContext.storyId, asset]);
    const target = useMemo(() => resolveStoryMotionPreviewTarget({
        document,
        sceneId: props.actionContext.sceneId,
        blockId: props.actionContext.blockId,
        fallbackKind: asset?.targetKind ?? props.fallbackKind,
        fallbackLabel: asset?.name ?? t("motion.fallbackLabel"),
        previewAssetId: asset?.previewAssetId,
    }), [document, props.actionContext, props.fallbackKind, asset, t]);
    const { url: backgroundUrl } = useAssetObjectUrl(asset?.previewBackgroundAssetId ?? null);

    const scale = Math.min(PREVIEW_BOX.width / stageSize.width, PREVIEW_BOX.height / stageSize.height);

    return (
        <div
            style={{ position: "fixed", top: props.position.top, left: props.position.left, width: PREVIEW_BOX.width, height: PREVIEW_BOX.height }}
            className="pointer-events-none z-[70] overflow-hidden rounded-lg border border-edge-strong bg-black/80 shadow-2xl backdrop-blur"
        >
            {asset ? (
                <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
                    <div style={{ width: stageSize.width * scale, height: stageSize.height * scale }}>
                        <div style={{ width: stageSize.width, height: stageSize.height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                            <StoryMotionStagePreview
                                preview={preview}
                                target={target}
                                onPointerDrag={() => undefined}
                                interactive={false}
                                stageSize={stageSize}
                                showLabel={false}
                                backgroundUrl={backgroundUrl}
                            />
                        </div>
                    </div>
                    <div className="absolute left-2 top-2 truncate rounded bg-black/55 px-1.5 py-0.5 text-2xs font-medium text-white">
                        {asset.name}
                    </div>
                    <div className="absolute right-2 bottom-2 rounded bg-black/55 px-1.5 py-0.5 text-2xs text-white/70">
                        {motionSummary(asset, t)}
                    </div>
                </div>
            ) : (
                <div className="grid h-full w-full place-items-center text-xs text-white/70">{t("motion.selector.loadingPreview")}</div>
            )}
        </div>
    );
}

/**
 * Compact transform-editor control that binds a Story Motion asset. Shows the bound motion (with
 * quick edit / clear) and opens the {@link MotionSelector} portal to change it.
 */
export function MotionField(props: {
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
    const [asset, setAsset] = useState<StoryAnimationAsset | null>(null);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!storyService || !animationId) {
            setAsset(null);
            return;
        }
        let disposed = false;
        void storyService.loadAnimationAsset(animationId)
            .then(loaded => { if (!disposed) setAsset(loaded); })
            .catch(() => { if (!disposed) setAsset(null); });
        return () => { disposed = true; };
    }, [animationId, storyService]);

    const bind = useCallback((assetId: string) => {
        props.onChange({ ...(props.value ?? {}), mode: "animation", animationId: assetId, preset: undefined });
        setSelectorOpen(false);
    }, [props]);

    const clear = useCallback(() => {
        props.onChange({ ...(props.value ?? {}), mode: "animation", animationId: undefined });
    }, [props]);

    const openEditor = useCallback(() => {
        if (animationId) {
            openEditorTab(createStoryMotionEditorTab({ animationId, actionContext: props.actionContext }));
        }
    }, [animationId, openEditorTab, props.actionContext]);

    return (
        <div className="flex items-center gap-2">
            <button
                ref={triggerRef}
                type="button"
                className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-edge bg-surface-raised px-3 text-left text-sm text-fg-muted hover:border-primary/40"
                onClick={() => setSelectorOpen(open => !open)}
            >
                <Spline className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className={["truncate", animationId ? "" : "italic text-fg-subtle"].join(" ")}>
                    {asset?.name ?? (animationId ? t("motion.field.motionAsset") : t("motion.field.choosePlaceholder"))}
                </span>
                {asset ? <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{motionSummary(asset, t)}</span> : null}
            </button>
            {animationId ? (
                <>
                    <button type="button" className={ICON_BUTTON_CLASS} onClick={openEditor} title={t("motion.editMotion")}>
                        <Edit3 className="h-4 w-4" />
                    </button>
                    <button type="button" className={ICON_BUTTON_CLASS} onClick={clear} title={t("motion.clearMotion")}>
                        <X className="h-4 w-4" />
                    </button>
                </>
            ) : null}
            <MotionSelector
                visible={selectorOpen}
                value={animationId}
                targetKind={props.targetKind}
                actionContext={props.actionContext}
                anchorRef={triggerRef}
                onClose={() => setSelectorOpen(false)}
                onSelect={bind}
            />
        </div>
    );
}
