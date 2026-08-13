import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, Edit3, Plus, Search, Spline, X } from "lucide-react";
import type {
    StoryAnimationAsset,
    StoryAnimationIndexEntry,
    StoryDocument,
    StoryMotionTargetKind,
    StoryTransformRef,
} from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { InspectOnlyButton } from "@/lib/components/elements/InspectOnlyButton";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { createStoryMotionEditorTab, resolveStoryMotionStageSize } from "./StoryMotionEditorTab";
import { resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";
import { StoryMotionLoopPreview } from "./StoryMotionLoopPreview";
import { StoryMotionPresetGallery } from "./StoryMotionPresetGallery";
import { motionSummary } from "./storyMotionSummary";
import type { StoryMotionActionContext } from "./storyMotionTypes";
import { getStoryMotionPreset } from "./storyMotionPresets";
import { createStoryMotionName } from "./storyMotionTimeline";

const WINDOW_TITLEBAR_HEIGHT = 40;
const HOVER_DELAY_MS = 340;
const PREVIEW_BOX = { width: 300, height: 176 };
const PREVIEW_GAP = 12;

const ICON_BUTTON_CLASS = controlButtonClass();
const TOOL_BUTTON_CLASS = "inline-flex h-9 cursor-default items-center gap-1.5 rounded-md border border-edge bg-fill-subtle px-2 text-xs text-fg hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";

/** Which half of the picker is showing: the project's own motions, or the preset library. */
type MotionSelectorTab = "project" | "presets";

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export { motionSummary };

/**
 * Anchored portal picker for Story Motion assets, modelled on the project asset selector.
 *
 * Two halves: the project's own motions for this target kind (live looping preview on hover), and the
 * preset library. The presets tab is what a project with no motions yet opens on — the old flow put a
 * four-item template dropdown beside a "New" button, which meant the author had to already know what
 * "Center pop" looked like before pressing anything.
 */
export function MotionSelector(props: {
    visible: boolean;
    value: string | undefined;
    targetKind: StoryMotionTargetKind;
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
    const [tab, setTab] = useState<MotionSelectorTab>("project");
    const [hovered, setHovered] = useState<{ id: string; top: number; left: number } | null>(null);
    const [anchorStyle, setAnchorStyle] = useState({ top: 0, left: 0, width: 360 });
    const panelRef = useRef<HTMLDivElement | null>(null);
    const hoverTimer = useRef<number | null>(null);

    useEffect(() => {
        if (!storyService || !props.visible) {
            return;
        }
        const initial = storyService.listAnimationAssets();
        setAssets([...initial]);
        // A project with no motion for this target has nothing to show in the project tab, so the
        // popover opens on the library instead of on an empty list.
        setTab(initial.some(asset => asset.targetKind === props.targetKind) ? "project" : "presets");
        return storyService.onAnimationsChanged(index => setAssets([...index.animations]));
    }, [storyService, props.visible, props.targetKind]);

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

    /**
     * Create a motion and bind it. With a preset id the new asset is seeded from the library (its
     * timeline, its repeat count, and a localized name); without one it is the blank motion the
     * timeline editor opens on.
     */
    const createAndBind = useCallback(async (presetId?: string) => {
        if (!storyService) {
            return;
        }
        const preset = presetId ? getStoryMotionPreset(presetId) : undefined;
        const asset = await storyService.createAnimationAsset({
            name: createStoryMotionName(
                t(`motion.targetKind.${props.targetKind}`),
                preset ? t(`motion.preset.${preset.id}`) : t("motion.blankMotionName"),
            ),
            targetKind: props.targetKind,
            timeline: preset?.build(),
            config: preset?.config,
        });
        props.onSelect(asset.id);
    }, [props, storyService, t]);

    const openEditor = useCallback((assetId: string) => {
        openEditorTab(createStoryMotionEditorTab({ animationId: assetId, actionContext: props.actionContext }));
    }, [openEditorTab, props.actionContext]);

    // The preview subject for the preset gallery: the very displayable (or camera) this action drives,
    // so a preset is auditioned on the author's own stage rather than on a placeholder.
    const storyDocument = useMemo<StoryDocument | null>(() => {
        if (!storyService || !props.visible) {
            return null;
        }
        try {
            return storyService.getStoryDocument(props.actionContext.storyId);
        } catch {
            return null;
        }
    }, [storyService, props.visible, props.actionContext.storyId]);
    const galleryTarget = useMemo(() => resolveStoryMotionPreviewTarget({
        document: storyDocument,
        sceneId: props.actionContext.sceneId,
        blockId: props.actionContext.blockId,
        fallbackKind: props.targetKind,
        fallbackLabel: t("motion.fallbackLabel"),
    }), [storyDocument, props.actionContext, props.targetKind, t]);
    const stageSize = useMemo(() => resolveStoryMotionStageSize(projectService), [projectService]);

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
                    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-edge bg-surface">
                        {(["project", "presets"] as const).map((option, index) => (
                            <button
                                key={option}
                                type="button"
                                className={[
                                    "h-8 px-2 text-xs transition-colors",
                                    index > 0 ? "border-l border-edge" : "",
                                    tab === option ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle hover:text-fg",
                                ].join(" ")}
                                onClick={() => setTab(option)}
                            >
                                {t(`motion.selector.tab.${option}`)}
                            </button>
                        ))}
                    </div>
                    {tab === "project" ? (
                        <>
                            <EnhancedInput
                                className="flex-1"
                                value={query}
                                onChange={setQuery}
                                placeholder={t("motion.searchStoryMotions")}
                                leftIcon={<Search className="h-3.5 w-3.5 text-fg-subtle" />}
                            />
                            <button className={TOOL_BUTTON_CLASS} type="button" onClick={() => void createAndBind()} disabled={!storyService}>
                                <Plus className="h-3.5 w-3.5" />
                                {t("common.new")}
                            </button>
                        </>
                    ) : (
                        <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                            {t(`motion.targetKind.${props.targetKind}`)}
                        </span>
                    )}
                </div>
                {tab === "presets" ? (
                    <div className="min-h-0 flex-1 overflow-auto p-1">
                        <StoryMotionPresetGallery
                            targetKind={props.targetKind}
                            target={galleryTarget}
                            stageSize={stageSize}
                            disabled={!storyService}
                            onPick={presetId => void createAndBind(presetId)}
                        />
                    </div>
                ) : (
                <div className="min-h-0 flex-1 overflow-auto p-1">
                    {/* Nothing to list: the list is empty. The Presets tab is one row above, inside
                        the same popover, so a sentence pointing at it adds only height. */}
                    {filteredAssets.length === 0 ? null : filteredAssets.map(asset => {
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
                                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle text-primary">
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
                                    data-tip={t("motion.editMotion")} aria-label={t("motion.editMotion")}
                                >
                                    <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                            </div>
                        );
                    })}
                </div>
                )}
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
    fallbackKind: StoryMotionTargetKind;
}) {
    const { t } = useTranslation();
    const [asset, setAsset] = useState<StoryAnimationAsset | null>(null);

    useEffect(() => {
        let disposed = false;
        setAsset(null);
        void props.storyService.loadAnimationAsset(props.animationId)
            .then(loaded => { if (!disposed) setAsset(loaded); })
            .catch(() => { if (!disposed) setAsset(null); });
        return () => { disposed = true; };
    }, [props.animationId, props.storyService]);

    const stageSize = useMemo(() => resolveStoryMotionStageSize(props.projectService), [props.projectService]);
    const storyDocument = useMemo<StoryDocument | null>(() => {
        try {
            return props.storyService.getStoryDocument(props.actionContext.storyId);
        } catch {
            return null;
        }
    }, [props.storyService, props.actionContext.storyId, asset]);
    const target = useMemo(() => resolveStoryMotionPreviewTarget({
        document: storyDocument,
        sceneId: props.actionContext.sceneId,
        blockId: props.actionContext.blockId,
        fallbackKind: asset?.targetKind ?? props.fallbackKind,
        fallbackLabel: asset?.name ?? t("motion.fallbackLabel"),
        previewAssetId: asset?.previewAssetId,
    }), [storyDocument, props.actionContext, props.fallbackKind, asset, t]);
    const { url: backgroundUrl } = useAssetObjectUrl(asset?.previewBackgroundAssetId ?? null);

    return (
        <div
            style={{ position: "fixed", top: props.position.top, left: props.position.left, width: PREVIEW_BOX.width, height: PREVIEW_BOX.height }}
            className="pointer-events-none z-[70] overflow-hidden rounded-lg border border-edge-strong bg-black/80 shadow-2xl backdrop-blur"
        >
            {asset ? (
                <StoryMotionLoopPreview
                    timeline={asset.timeline}
                    target={target}
                    stageSize={stageSize}
                    box={PREVIEW_BOX}
                    backgroundUrl={backgroundUrl}
                    caption={asset.name}
                    footer={motionSummary(asset, t)}
                />
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
    targetKind: StoryMotionTargetKind;
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
                {/* The name gets the whole field. The duration/properties summary used to sit here too
                    and, in an inspector-width panel, it won: a bound motion read as "Stag…" with a
                    tidy "0.42s / Position" beside it. The summary is one hover away in the picker and
                    on the row in the editor; which motion is bound is the thing this control is for. */}
                <span className={["min-w-0 truncate", animationId ? "" : "italic text-fg-subtle"].join(" ")}>
                    {asset?.name ?? (animationId ? t("motion.field.motionAsset") : t("motion.field.choosePlaceholder"))}
                </span>
            </button>
            {animationId ? (
                <>
                    {/* The pencil opens the motion in its own editor tab and writes nothing on the
                        way. An {@link InspectOnlyButton} because this field is mounted in the story
                        action inspector, which a frozen workspace clamps in a `disabled`
                        `<fieldset>`: as a `<button>` this went dead with the rest, so an author
                        reading a past version could see a motion was bound but never open it and
                        look at the curve. The ✕ beside it does write, and stays under the clamp. */}
                    <InspectOnlyButton
                        className={`${ICON_BUTTON_CLASS} cursor-default`}
                        onClick={openEditor}
                        data-tip={t("motion.editMotion")}
                        aria-label={t("motion.editMotion")}
                    >
                        <Edit3 className="h-4 w-4" />
                    </InspectOnlyButton>
                    <button type="button" className={ICON_BUTTON_CLASS} onClick={clear} data-tip={t("motion.clearMotion")} aria-label={t("motion.clearMotion")}>
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
