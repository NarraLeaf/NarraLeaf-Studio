import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    type SetStateAction,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bug, Check, ChevronsRight } from "lucide-react";
import { StageViewportFrame } from "@/lib/ui-editor/runtime/app/StageViewportFrame";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle, DevModeEntry } from "@shared/types/devMode";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { BlueprintPersistenceProjectRef } from "@shared/types/ipcEvents";
import type { DevModeSaveProjectRef } from "@shared/types/devModeSave";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { BlueprintRuntimeDebugPanel } from "./BlueprintRuntimeDebugPanel";
import { StoryRuntimeDebugPanel } from "./StoryRuntimeDebugPanel";
import type { DevModePanelChrome } from "./DevModePanelChrome";
import { GameApp } from "@/lib/ui-editor/runtime/app/GameApp";
import type {
    GameAppBootAction,
    GameAppFrameContext,
    GameAppHost,
    GameAppOverlayContext,
    GameAppSaveStore,
    GameAppStoryRuntimeBridge,
} from "@/lib/ui-editor/runtime/app/GameAppHost";
import { RuntimePluginHostController } from "@/lib/ui-editor/runtime/plugins/runtimePluginHostController";
import { blockIdForActionId } from "./storyRuntimeDebugModel";
import { useDevModeRuntimePlugins } from "../hooks/useDevModeRuntimePlugins";
import { resolveDevModeViewportSize } from "./devModeViewport";

type DevModeContentProps = {
    bundle: DevModeBundle | null;
    entry: DevModeEntry | null;
    projectPath: string | null;
    surface: UISurface | null;
    surfaceId: string;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    handleAspectUpdate: (metrics: { scale: number }) => void;
    sessionError: string | null;
    onDismissSessionError: () => void;
};

function SessionErrorBanner(props: {
    sessionError: string | null;
    onDismissSessionError: () => void;
}): ReactNode {
    const { sessionError, onDismissSessionError } = props;
    const { t } = useTranslation();
    if (!sessionError) {
        return null;
    }
    return (
        <div className="shrink-0 border-b border-danger/40 bg-danger/15 px-3 py-2 text-xs text-danger">
            <div className="flex items-start justify-between gap-2">
                <pre className="max-h-24 flex-1 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-snug">
                    {sessionError}
                </pre>
                <button
                    type="button"
                    className="shrink-0 rounded-md border border-danger/50 px-2 py-0.5 text-2xs text-danger hover:bg-danger/25"
                    onClick={onDismissSessionError}
                >
                    {t("devMode.dismiss")}
                </button>
            </div>
        </div>
    );
}

type DevModeDebugPanelId = "none" | "blueprint" | "story";

/** Width the debug drawer takes off the stage while it is open. */
const DEBUG_PANEL_WIDTH = 380;

/** Gap kept between a floating panel and the edge of the run area, and the clamp it is held to. */
const FLOAT_PANEL_MARGIN = 16;

/**
 * How tall a floating panel is: tall enough to read a timeline in, short enough that it can still be
 * moved vertically. `h-full` would be a panel that floats and cannot be dragged out of the way in
 * the one axis that matters, which is the failure this card exists to avoid.
 */
const FLOAT_PANEL_HEIGHT = `min(560px, calc(100% - ${FLOAT_PANEL_MARGIN * 2}px))`;

/** Position of a floating panel inside the run area; `null` means "still at the default anchor". */
type FloatPanelPosition = { x: number; y: number } | null;

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * The box a floating panel is clamped inside, and where the panel currently sits in it.
 *
 * Read off the DOM rather than tracked in state on purpose: the run area is the panel's own
 * `offsetParent`, so this is the same box the browser positions it against, and it stays correct
 * whether the panel is anchored by `right` (its default) or by an explicit `left` from a drag.
 */
function measureFloatBounds(panel: HTMLElement | null): {
    left: number;
    top: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
} | null {
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) {
        return null;
    }
    const area = parent.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    return {
        left: box.x - area.x,
        top: box.y - area.y,
        minX: FLOAT_PANEL_MARGIN,
        maxX: Math.max(FLOAT_PANEL_MARGIN, area.width - box.width - FLOAT_PANEL_MARGIN),
        minY: FLOAT_PANEL_MARGIN,
        maxY: Math.max(FLOAT_PANEL_MARGIN, area.height - box.height - FLOAT_PANEL_MARGIN),
    };
}

/** Studio-only debug tools: floating action button, tools menu, and the live-debug panels. */
function DevModeDebugOverlay(props: {
    core: BlueprintRuntimeCore;
    bundle: DevModeBundle;
    uidoc: UIDocument;
    activeSurfaceId: string;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    projectPath: string | null;
    fastForwardToNextChoice: () => Promise<void>;
    storyRuntime: GameAppStoryRuntimeBridge;
    /** Owned by DevModeContent so the drawer survives a game-session remount (every timeline jump). */
    activePanel: DevModeDebugPanelId;
    setActivePanel: (update: (previous: DevModeDebugPanelId) => DevModeDebugPanelId) => void;
    /** Dock/float mode, owned at the same level and for the same reason as `activePanel`. */
    panelFloating: boolean;
    setPanelFloating: Dispatch<SetStateAction<boolean>>;
    floatPosition: FloatPanelPosition;
    setFloatPosition: Dispatch<SetStateAction<FloatPanelPosition>>;
}) {
    const {
        core, bundle, uidoc, activeSurfaceId, widgetRuntimeStore, projectPath, fastForwardToNextChoice, storyRuntime,
        activePanel, setActivePanel,
        panelFloating, setPanelFloating, floatPosition, setFloatPosition,
    } = props;
    const { t } = useTranslation();
    const [devtoolsMenuOpen, setDevtoolsMenuOpen] = useState(false);
    const [fastForwarding, setFastForwarding] = useState(false);
    const devtoolsFabRef = useRef<HTMLButtonElement>(null);
    const devtoolsMenuRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    /** Where the panel is being dragged to right now; `null` whenever no drag is in flight. */
    const [dragPosition, setDragPosition] = useState<FloatPanelPosition>(null);
    /** Tears down an in-flight title-bar drag (also on unmount, so no listener outlives the panel). */
    const endDragRef = useRef<(() => void) | null>(null);
    useEffect(() => () => endDragRef.current?.(), []);
    const activeFloatPosition = dragPosition ?? floatPosition;

    // Mirror the play head to the workspace story editor (row highlight) whenever a story runs, even
    // with the debug panels closed. Coalesced to one forward per frame; the workspace reveals the row
    // in-place without stealing focus, and quietly ignores it when no matching editor is open.
    useEffect(() => {
        if (!projectPath) {
            return;
        }
        let raf = 0;
        let lastBlockId: string | null = null;
        const flush = (): void => {
            raf = 0;
            const context = storyRuntime.getStoryContext();
            if (!context) {
                return;
            }
            const blockId = blockIdForActionId(storyRuntime.getActionIdBindings(), storyRuntime.getCurrentActionId());
            if (!blockId || blockId === lastBlockId) {
                return;
            }
            lastBlockId = blockId;
            // The play head can be in a scene reached by a jump, not the launched one, so forward the
            // scene that actually owns the block — otherwise the workspace editor could not match it.
            let sceneId = context.sceneId;
            const document = bundle.storyLibrary?.documents[context.storyId];
            if (document) {
                for (const [id, scene] of Object.entries(document.scenes)) {
                    if (blockId in scene.blocks) {
                        sceneId = id;
                        break;
                    }
                }
            }
            try {
                getInterface().devMode.forwardStoryRow({
                    projectPath,
                    storyId: context.storyId,
                    sceneId,
                    blockId,
                });
            } catch (error) {
                console.warn("[DevMode] failed to forward story row", error);
            }
        };
        const unsubscribe = storyRuntime.subscribeCurrentAction(() => {
            if (!raf) {
                raf = requestAnimationFrame(flush);
            }
        });
        return () => {
            if (raf) {
                cancelAnimationFrame(raf);
            }
            unsubscribe();
        };
    }, [projectPath, storyRuntime, bundle]);

    const handleFastForward = useCallback(async () => {
        setDevtoolsMenuOpen(false);
        if (fastForwarding) {
            return;
        }
        setFastForwarding(true);
        try {
            await fastForwardToNextChoice();
        } catch {
            // No game running, or the run was interrupted — a debug affordance, so swallow quietly.
        } finally {
            setFastForwarding(false);
        }
    }, [fastForwarding, fastForwardToNextChoice]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            // Ctrl/Cmd + → : fast-forward to the next choice.
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "ArrowRight") {
                e.preventDefault();
                void handleFastForward();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [handleFastForward]);

    useEffect(() => {
        if (!devtoolsMenuOpen) {
            return;
        }
        const onPointerDown = (e: PointerEvent) => {
            const t = e.target as Node;
            if (devtoolsFabRef.current?.contains(t)) {
                return;
            }
            if (devtoolsMenuRef.current?.contains(t)) {
                return;
            }
            setDevtoolsMenuOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [devtoolsMenuOpen]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") {
                return;
            }
            if (devtoolsMenuOpen) {
                setDevtoolsMenuOpen(false);
                e.preventDefault();
                return;
            }
            if (activePanel !== "none") {
                setActivePanel(() => "none");
                e.preventDefault();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [devtoolsMenuOpen, activePanel]);

    /**
     * Drag a floating panel by its title bar.
     *
     * Real pointer input: `pointerdown` on the title bar, then `pointermove` / `pointerup` on the
     * window. HTML5 `draggable` is not an option here — in this repo it needs a `.nl-drag-source`
     * opt-in, and it would be dragging a *thing* rather than moving a window-like panel.
     *
     * Two details that are not incidental:
     *  - the window listeners are registered in the CAPTURE phase, so a `stopPropagation` anywhere
     *    inside the running game (whose stage is directly under the panel) cannot swallow the drag;
     *  - the live position is the overlay's OWN state and is handed to the owner only on release, so
     *    a drag re-renders the panel and not GameApp — the whole running game — per pointermove.
     */
    const handleTitleBarPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (!panelFloating || event.button !== 0) {
            return;
        }
        // Never steal a press aimed at a control that lives in the title bar (the snapshot select,
        // the mode toggle). Those are not drag handles.
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, [role="button"], [role="switch"], select, input, textarea, [role="combobox"], [role="listbox"]')) {
            return;
        }
        const bounds = measureFloatBounds(panelRef.current);
        if (!bounds) {
            return;
        }
        endDragRef.current?.();

        const startX = event.clientX;
        const startY = event.clientY;
        let moved: { x: number; y: number } | null = null;

        const onMove = (move: PointerEvent): void => {
            // Clamped every frame, not just at the end: the panel has to stay inside the run area
            // for the whole gesture, or "drag it past the edge" briefly shows a half-off panel.
            const next = {
                x: clamp(bounds.left + (move.clientX - startX), bounds.minX, bounds.maxX),
                y: clamp(bounds.top + (move.clientY - startY), bounds.minY, bounds.maxY),
            };
            moved = next;
            setDragPosition(next);
        };
        const detach = (): void => {
            window.removeEventListener("pointermove", onMove, true);
            window.removeEventListener("pointerup", onUp, true);
            window.removeEventListener("pointercancel", onUp, true);
            endDragRef.current = null;
        };
        function onUp(): void {
            detach();
            // A press with no movement is a click on the title bar, not a drag: leave the position
            // alone rather than pinning the panel to wherever it happened to already be. Both
            // updates land in one render, so handing the position over never flickers.
            if (moved) {
                setFloatPosition(moved);
            }
            setDragPosition(null);
        }

        endDragRef.current = detach;
        window.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", onUp, true);
        window.addEventListener("pointercancel", onUp, true);
        // Suppress the text selection a press-and-drag across the title would otherwise start.
        event.preventDefault();
    }, [panelFloating, setFloatPosition]);

    // Keep a dragged panel inside the run area when the area itself changes (window resize, the
    // session-error banner appearing). Only ever pulls the panel back in; it never moves one that
    // still fits.
    useEffect(() => {
        const panel = panelRef.current;
        const parent = panel?.offsetParent as HTMLElement | null;
        if (!panelFloating || !panel || !parent || typeof ResizeObserver === "undefined") {
            return;
        }
        const reclamp = (): void => {
            setFloatPosition(previous => {
                const bounds = measureFloatBounds(panelRef.current);
                if (!previous || !bounds) {
                    return previous;
                }
                const x = clamp(previous.x, bounds.minX, bounds.maxX);
                const y = clamp(previous.y, bounds.minY, bounds.maxY);
                return x === previous.x && y === previous.y ? previous : { x, y };
            });
        };
        const observer = new ResizeObserver(reclamp);
        observer.observe(parent);
        return () => observer.disconnect();
    }, [panelFloating, activePanel, setFloatPosition]);

    const panelChrome = useMemo<DevModePanelChrome>(() => ({
        floating: panelFloating,
        onToggleFloating: () => setPanelFloating(previous => !previous),
        onTitleBarPointerDown: handleTitleBarPointerDown,
    }), [panelFloating, setPanelFloating, handleTitleBarPointerDown]);

    return (
        <>
            <AnimatePresence>
                {activePanel !== "none" ? (
                    // Docked, this is a flex SIBLING of the stage, not an overlay: the stage yields
                    // the width and re-fits (StageViewportFrame measures its own box), so opening the
                    // panel never crops what is being debugged. Floating, the very same element goes
                    // out of flow — which is what hands the width back to the stage, again by the
                    // frame measuring itself rather than by anyone computing a width for it.
                    //
                    // One element across both modes, and one key: two elements cross-fading would put
                    // two `role="complementary"` boxes in the DOM at once, and everything that looks
                    // the panel up — assistive tech included — takes the first one it finds.
                    <motion.div
                        key={activePanel}
                        ref={panelRef}
                        role="complementary"
                        aria-label={activePanel === "story" ? t("devMode.runtime.title") : t("devMode.devtools.title")}
                        className={
                            panelFloating
                                // A plain border rather than a `ring`: the game window has
                                // narraleaf-react's own Tailwind v4 sheet in it, which is already
                                // known to neutralise v3 utilities that ride on CSS custom
                                // properties, and the one line separating this panel from the stage
                                // under it is not a good place to find out.
                                ? "pointer-events-auto absolute z-30 overflow-hidden rounded-lg border border-edge-strong shadow-2xl"
                                : "pointer-events-auto relative z-30 h-full shrink-0 overflow-hidden"
                        }
                        style={panelFloating
                            ? {
                                height: FLOAT_PANEL_HEIGHT,
                                top: activeFloatPosition ? activeFloatPosition.y : FLOAT_PANEL_MARGIN,
                                // Anchored to the trailing edge until it is dragged — the corner it
                                // was docked at, and the one place a 380px panel is guaranteed not to
                                // sit on top of the stage it is there to observe. Both edges are
                                // always written, so switching anchors is a value change rather than
                                // a property React has to remember to remove.
                                left: activeFloatPosition ? activeFloatPosition.x : "auto",
                                right: activeFloatPosition ? "auto" : FLOAT_PANEL_MARGIN,
                            }
                            : undefined}
                        // Only the box animates; the body inside keeps its full width so the panel's
                        // own layout does not reflow on the way in.
                        initial={{ width: 0 }}
                        animate={{ width: DEBUG_PANEL_WIDTH }}
                        exit={{ width: 0 }}
                        transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <div className="absolute inset-y-0 right-0" style={{ width: DEBUG_PANEL_WIDTH }}>
                            {activePanel === "story" ? (
                                <StoryRuntimeDebugPanel
                                    storyRuntime={storyRuntime}
                                    scopeBridge={core.scopeBridge}
                                    bundle={bundle}
                                    className="h-full min-h-0 w-full"
                                    chrome={panelChrome}
                                />
                            ) : (
                                <BlueprintRuntimeDebugPanel
                                    debug={core.debug}
                                    blueprintDocument={bundle.ui.localBlueprints}
                                    uiDocument={uidoc}
                                    activeSurfaceId={activeSurfaceId}
                                    scopeBridge={core.scopeBridge}
                                    widgetRuntimeStore={widgetRuntimeStore}
                                    projectPath={projectPath}
                                    className="h-full min-h-0 w-full"
                                    chrome={panelChrome}
                                />
                            )}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <div className="pointer-events-none absolute inset-0 z-40">
                <div className="pointer-events-auto absolute bottom-3 left-3">
                    <div className="relative flex w-11 flex-col items-start">
                        {devtoolsMenuOpen ? (
                            <div
                                ref={devtoolsMenuRef}
                                role="menu"
                                aria-label={t("devMode.devtools.menuAria")}
                                className="absolute bottom-full left-0 z-10 mb-2 w-[min(15rem,calc(100vw-1.5rem))] rounded-md border border-edge bg-surface-overlay py-1 shadow-lg"
                            >
                                <button
                                    type="button"
                                    role="menuitem"
                                    disabled={fastForwarding}
                                    className={`flex w-full cursor-default items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                                        fastForwarding
                                            ? "text-fg-subtle"
                                            : "text-fg-muted hover:bg-fill hover:text-fg"
                                    }`}
                                    onClick={() => { void handleFastForward(); }}
                                >
                                    <span
                                        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                                        aria-hidden
                                    >
                                        <ChevronsRight className="h-3.5 w-3.5" />
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">
                                        {fastForwarding
                                            ? t("devMode.devtools.skipToNextChoiceBusy")
                                            : t("devMode.devtools.skipToNextChoice")}
                                    </span>
                                </button>
                                {(
                                    [
                                        ["story", t("devMode.runtime.title")],
                                        ["blueprint", t("devMode.devtools.title")],
                                    ] as const
                                ).map(([id, label]) => {
                                    const open = activePanel === id;
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            role="menuitem"
                                            aria-pressed={open}
                                            className={`flex w-full cursor-default items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                                                open
                                                    ? "bg-fill-strong text-fg"
                                                    : "text-fg-muted hover:bg-fill hover:text-fg"
                                            }`}
                                            onClick={() => {
                                                setActivePanel(prev => (prev === id ? "none" : id));
                                                setDevtoolsMenuOpen(false);
                                            }}
                                        >
                                            <span
                                                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                                                aria-hidden
                                            >
                                                {open ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate">{label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                        <button
                            ref={devtoolsFabRef}
                            type="button"
                            className="pointer-events-auto flex h-11 w-11 shrink-0 cursor-default items-center justify-center rounded-full border border-edge bg-surface-overlay shadow-md outline-none ring-edge-strong transition-colors duration-150 hover:border-edge-strong hover:bg-surface-raised hover:shadow-lg focus-visible:ring-2"
                            aria-label={devtoolsMenuOpen ? t("devMode.devtools.closeMenu") : t("devMode.devtools.openMenu")}
                            aria-expanded={devtoolsMenuOpen}
                            aria-haspopup="menu"
                            onClick={() => setDevtoolsMenuOpen(prev => !prev)}
                        >
                            <Bug className="h-5 w-5 text-fg-muted" aria-hidden />
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

export function DevModeContent(props: DevModeContentProps) {
    const { t } = useTranslation();
    const {
        bundle,
        entry,
        projectPath,
        surface,
        surfaceId,
        rendererRegistry,
        scale,
        handleAspectUpdate,
        sessionError,
        onDismissSessionError,
    } = props;

    // A "story" launch entry (a row's ▶ in the story editor) boots straight into the game at that
    // scene/row; everything else boots to the app surface (the menu). Mirrors how the packaged
    // runtime honors a story entry.
    const bootAction = useMemo<GameAppBootAction>(() => {
        if (entry?.kind === "story") {
            return {
                kind: "story",
                storyId: entry.storyId,
                sceneId: entry.sceneId,
                startBlockId: entry.blockId,
                snapshotId: entry.snapshotId,
            };
        }
        return { kind: "surface" };
    }, [entry]);

    const projectRef = useMemo<BlueprintPersistenceProjectRef & DevModeSaveProjectRef | null>(() => {
        if (!projectPath) {
            return null;
        }
        const rawIdentifier = bundle?.meta?.projectIdentifier;
        const projectIdentifier =
            typeof rawIdentifier === "string" && rawIdentifier.trim() ? rawIdentifier.trim() : undefined;
        return {
            projectIdentifier,
            projectPath,
        };
    }, [bundle?.meta?.projectIdentifier, projectPath]);

    const persistenceAdapter = useMemo(() => {
        if (!projectRef) {
            return null;
        }
        return {
            getAll: async () => {
                const result = await getInterface().blueprintPersistence.getAll(projectRef);
                if (!result.success) {
                    throw new Error(result.error ?? "Failed to read Blueprint persistent values");
                }
                return result.data.values;
            },
            getValue: async (key: string) => {
                const result = await getInterface().blueprintPersistence.getValue(projectRef, key);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to read Blueprint persistent value "${key}"`);
                }
                return result.data.value;
            },
            setValue: async (key: string, value: unknown) => {
                const result = await getInterface().blueprintPersistence.setValue(projectRef, key, value);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to write Blueprint persistent value "${key}"`);
                }
            },
            removeValue: async (key: string) => {
                const result = await getInterface().blueprintPersistence.removeValue(projectRef, key);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to remove Blueprint persistent value "${key}"`);
                }
            },
        };
    }, [projectRef]);

    const onDebugEvent = useCallback((event: BlueprintDebugEvent) => {
        if (!projectPath) {
            return;
        }
        try {
            getInterface().devMode.forwardBlueprintDebugEvent({ projectPath, event });
        } catch (error) {
            console.warn("[DevMode] failed to forward blueprint debug event", error);
        }
    }, [projectPath]);

    const log = useCallback<GameAppHost["log"]>((level, message) => {
        if (level === "error") {
            console.error(message);
        } else if (level === "warning") {
            console.warn(message);
        } else {
            console.info(message);
        }
    }, []);

    const resolveStoryAssetUrl = useCallback<GameAppHost["resolveStoryAssetUrl"]>(async (assetId, assetType) => {
        const result = await getInterface().devMode.resolveAssetUrl(assetId, assetType);
        if (!result.success || !result.data?.url) {
            throw new Error(result.error ?? `Failed to resolve asset: ${assetId}`);
        }
        return result.data.url;
    }, []);

    const requireProjectRef = useCallback((operation: string): DevModeSaveProjectRef => {
        if (!projectRef) {
            throw new Error(`${operation}: project is not available`);
        }
        return projectRef;
    }, [projectRef]);

    const saveStore = useMemo<GameAppSaveStore>(() => ({
        write: async (id, savedGame, capture, metadata) => {
            const ref = requireProjectRef("Save Game");
            const result = await getInterface().devMode.save.write(ref, id, savedGame, capture, metadata);
            if (!result.success) {
                throw new Error(result.error ?? `Save Game failed: ${id}`);
            }
        },
        read: async id => {
            const ref = requireProjectRef("Load Save");
            const result = await getInterface().devMode.save.read(ref, id);
            if (!result.success) {
                throw new Error(result.error ?? `Load Save failed: ${id}`);
            }
            return result.data.record ?? null;
        },
        readPreview: async id => {
            const ref = requireProjectRef("Get Save Preview");
            const result = await getInterface().devMode.save.readPreview(ref, id);
            if (!result.success) {
                throw new Error(result.error ?? `Get Save Preview failed: ${id}`);
            }
            return result.data.capture;
        },
        remove: async id => {
            const ref = requireProjectRef("Delete Save");
            const result = await getInterface().devMode.save.delete(ref, id);
            if (!result.success) {
                throw new Error(result.error ?? `Delete Save failed: ${id}`);
            }
        },
        listIds: async () => {
            const ref = requireProjectRef("List Saves");
            const result = await getInterface().devMode.save.listIds(ref);
            if (!result.success) {
                throw new Error(result.error ?? "List Saves failed");
            }
            return result.data.ids;
        },
    }), [requireProjectRef]);

    const quitApplication = useCallback(async (): Promise<void> => {
        if (!projectPath) {
            throw new Error("Quit failed: no project");
        }
        // Names its own project: another project's Dev Mode session may be running alongside.
        const result = await getInterface().devMode.stop(projectPath);
        if (!result.success) {
            throw new Error(result.error ?? "Quit failed");
        }
    }, [projectPath]);

    const getFullscreen = useCallback(async (): Promise<boolean> => {
        const result = await getInterface().devMode.getFullscreen();
        if (!result.success) {
            throw new Error(result.error ?? "Get Fullscreen failed");
        }
        return result.data.isFullscreen;
    }, []);

    const setFullscreen = useCallback(async (fullscreen: boolean): Promise<void> => {
        const result = await getInterface().devMode.setFullscreen(fullscreen);
        if (!result.success) {
            throw new Error(result.error ?? "Set Fullscreen failed");
        }
    }, []);

    const subscribeFullscreenChanged = useCallback((listener: (isFullscreen: boolean) => void): (() => void) => {
        const token = getInterface().devMode.onFullscreenChanged(({ isFullscreen }) => listener(isFullscreen));
        return () => token.cancel();
    }, []);

    // The Dev Mode window's close guard lives in the main process, which blocks the close until we
    // answer. The blueprint's decision comes from GameApp, which registers below once it is ready.
    // Registered on mount rather than with the host, so closing while the game is still starting up
    // never hangs on a listener that does not exist yet — it just agrees to close.
    //
    // A set, not a single slot: runtime plugins observe the same request, and a second registration
    // must not silently unseat the blueprint decider. All handlers are asked and the close proceeds
    // only if every one agrees, which leaves the single-decider case byte-for-byte as it was.
    const closeListenersRef = useRef(new Set<() => Promise<boolean> | boolean>());
    useEffect(() => {
        const listeners = closeListenersRef.current;
        const token = getInterface().devMode.onCloseRequested(async () => {
            const allows = await Promise.all(Array.from(listeners).map(async listener => {
                try {
                    return await listener();
                } catch (error) {
                    // A failing close handler must not trap the window open.
                    console.error("[DevMode] Window close handler failed, allowing close:", error);
                    return true;
                }
            }));
            return { success: true, data: { allow: allows.every(allow => allow !== false) } };
        });
        return () => token.cancel();
    }, []);

    const subscribeCloseRequested = useCallback((listener: () => Promise<boolean> | boolean): (() => void) => {
        const listeners = closeListenersRef.current;
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    // The project reference arrives with the Dev Mode payload, while runtime plugins load on mount.
    // Backends therefore resolve it lazily: a plugin that reads storage during setup waits for the
    // payload instead of failing on a null project.
    const projectRefRef = useRef<DevModeSaveProjectRef | null>(null);
    const projectRefWaitersRef = useRef(new Set<(ref: DevModeSaveProjectRef) => void>());
    useEffect(() => {
        projectRefRef.current = projectRef;
        if (!projectRef) {
            return;
        }
        const waiters = Array.from(projectRefWaitersRef.current);
        projectRefWaitersRef.current.clear();
        for (const resolve of waiters) {
            resolve(projectRef);
        }
    }, [projectRef]);
    const awaitProjectRef = useCallback((): Promise<DevModeSaveProjectRef> => {
        const current = projectRefRef.current;
        if (current) {
            return Promise.resolve(current);
        }
        return new Promise(resolve => {
            projectRefWaitersRef.current.add(resolve);
        });
    }, []);

    // Runtime plugin capability backends for the Dev Mode window. Built once and kept stable:
    // plugin setup captures these objects, and they have to outlive every bundle revision and
    // in-window relaunch.
    const pluginHost = useMemo(() => new RuntimePluginHostController({
        persistence: {
            getAll: async () => {
                const result = await getInterface().blueprintPersistence.getAll(await awaitProjectRef());
                if (!result.success) {
                    throw new Error(result.error ?? "Failed to read plugin storage");
                }
                return result.data.values;
            },
            getValue: async key => {
                const result = await getInterface().blueprintPersistence.getValue(await awaitProjectRef(), key);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to read plugin storage key "${key}"`);
                }
                return result.data.value;
            },
            setValue: async (key, value) => {
                const result = await getInterface().blueprintPersistence.setValue(await awaitProjectRef(), key, value);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to write plugin storage key "${key}"`);
                }
            },
            removeValue: async key => {
                const result = await getInterface().blueprintPersistence.removeValue(await awaitProjectRef(), key);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to remove plugin storage key "${key}"`);
                }
            },
        },
        saves: {
            // The Dev Mode window always mounts a game app, which attaches the
            // write and load paths once it is up.
            writable: true,
            listIds: async () => {
                const result = await getInterface().devMode.save.listIds(await awaitProjectRef());
                if (!result.success) {
                    throw new Error(result.error ?? "List Saves failed");
                }
                return result.data.ids;
            },
            readMetadata: async id => {
                const result = await getInterface().devMode.save.read(await awaitProjectRef(), id);
                if (!result.success) {
                    throw new Error(result.error ?? `Read Save failed: ${id}`);
                }
                const record = result.data.record;
                if (!record) {
                    return null;
                }
                const updatedAt = Date.parse(record.metadata.updatedAt ?? "");
                return {
                    id: record.metadata.id ?? id,
                    ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
                    ...(record.metadata.user === undefined ? {} : { metadata: record.metadata.user }),
                };
            },
        },
        // No `assets` backend on purpose: Dev Mode resolves asset ids over IPC, and the capability
        // is a synchronous `url(assetId)`. A shell that cannot answer synchronously must leave the
        // namespace absent rather than hand out a URL it has to guess.
        subscribeFullscreenChanged: listener => {
            const token = getInterface().devMode.onFullscreenChanged(({ isFullscreen }) => listener(isFullscreen));
            return () => token.cancel();
        },
        // Observers only: a plugin never gets to veto the close, so this handler always agrees and
        // the blueprint decider stays the only thing that can cancel one.
        subscribeCloseRequested: listener => subscribeCloseRequested(() => {
            listener();
            return true;
        }),
        log: (level, message) => {
            if (level === "error") {
                console.error(`[DevMode] ${message}`);
            } else if (level === "warning") {
                console.warn(`[DevMode] ${message}`);
            } else {
                console.info(`[DevMode] ${message}`);
            }
        },
    }), [awaitProjectRef, subscribeCloseRequested]);
    useEffect(() => pluginHost.bindShellEvents(), [pluginHost]);

    // Runtime plugin entries must be registered before the game boots so
    // plugin blueprint nodes and widget renderers resolve at execution time.
    // Failed plugins are logged and skipped; they never block the game.
    const runtimePlugins = useDevModeRuntimePlugins(rendererRegistry, pluginHost);

    const host = useMemo<GameAppHost | null>(() => {
        if (!bundle || !surface) {
            return null;
        }
        return {
            id: "DevMode",
            bundle,
            sessionKey: `${bundle.bundleId}:${bundle.revision}:${surface.id}`,
            entrySurfaceId: surface.id,
            ready: runtimePlugins.ready,
            bootAction,
            persistenceAdapter,
            onDebugEvent,
            disposeMessage: "Dev Mode runtime disposed",
            log,
            resolveStoryAssetUrl,
            saveStore,
            quitApplication,
            getFullscreen,
            setFullscreen,
            subscribeFullscreenChanged,
            subscribeCloseRequested,
        };
    }, [
        bootAction,
        bundle,
        getFullscreen,
        log,
        onDebugEvent,
        persistenceAdapter,
        quitApplication,
        resolveStoryAssetUrl,
        runtimePlugins.ready,
        saveStore,
        setFullscreen,
        subscribeFullscreenChanged,
        subscribeCloseRequested,
        surface,
    ]);

    const getScale = useCallback(() => scale, [scale]);

    const renderFrame = useCallback((ctx: GameAppFrameContext) => {
        const viewportSize = resolveDevModeViewportSize({
            activeSurfaceDesignSize: ctx.activeSurface.designSize,
            gameViewport: ctx.gameViewport,
        });
        return (
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <div className="min-h-0 min-w-0 flex-1">
                    <StageViewportFrame
                        designSize={viewportSize}
                        onRenderScaleChange={value => handleAspectUpdate({ scale: value })}
                    >
                        {ctx.children}
                    </StageViewportFrame>
                </div>
            </div>
        );
    }, [handleAspectUpdate]);

    const renderPlaceholder = useCallback(() => (
        <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
            {t("devMode.surfaceUnavailable")}
        </div>
    ), [t]);

    // Which debug drawer is open is a property of the window, not of the game session: a timeline
    // jump relaunches the session, and state owned by the overlay itself would close the very panel
    // the jump was made from.
    const [activePanel, setActivePanel] = useState<DevModeDebugPanelId>("none");
    // Docked or floating, and where a floating panel was last dropped. Same owner, same reason:
    // both have to outlive closing the drawer and outlive the session remount a timeline jump
    // causes, or the mode silently resets under the author every time they jump. Deliberately NOT
    // persisted across Dev Mode windows — that is the snapshot selector's level of memory, and the
    // card scopes it there.
    const [panelFloating, setPanelFloating] = useState(false);
    const [floatPosition, setFloatPosition] = useState<FloatPanelPosition>(null);

    const renderOverlays = useCallback((ctx: GameAppOverlayContext) => {
        if (!ctx.core || !ctx.activeSurface || !bundle) {
            return null;
        }
        return (
            <DevModeDebugOverlay
                core={ctx.core}
                bundle={bundle}
                uidoc={bundle.ui.uidoc}
                activeSurfaceId={ctx.activeSurface.id}
                widgetRuntimeStore={ctx.widgetRuntimeStore}
                projectPath={projectPath}
                fastForwardToNextChoice={ctx.fastForwardToNextChoice}
                storyRuntime={ctx.storyRuntime}
                activePanel={activePanel}
                setActivePanel={setActivePanel}
                panelFloating={panelFloating}
                setPanelFloating={setPanelFloating}
                floatPosition={floatPosition}
                setFloatPosition={setFloatPosition}
            />
        );
    }, [bundle, projectPath, activePanel, panelFloating, floatPosition]);

    if (!bundle || !host) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
                <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
                    {t("devMode.waitingPayload")}
                </div>
            </div>
        );
    }

    if (!surface) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
                <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
                    {t("devMode.surfaceNotFound", { surfaceId })}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
            <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
            {/* Stage and debug drawer are siblings in one row: GameApp renders the frame and the
                overlays next to each other, so the drawer takes width from the stage instead of
                covering it. The FAB layer inside the overlays is still absolute, against this box. */}
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <GameApp
                    host={host}
                    rendererRegistry={rendererRegistry}
                    getScale={getScale}
                    renderFrame={renderFrame}
                    renderPlaceholder={renderPlaceholder}
                    renderOverlays={renderOverlays}
                    pluginHost={pluginHost}
                />
            </div>
        </div>
    );
}
