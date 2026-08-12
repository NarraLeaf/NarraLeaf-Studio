import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type PointerEvent as ReactPointerEvent,
    type SetStateAction,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bug, Check, ChevronsRight, EyeOff } from "lucide-react";
import { StageViewportFrame } from "@/lib/ui-editor/runtime/app/StageViewportFrame";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle, DevModeEntry } from "@shared/types/devMode";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { BlueprintPersistenceProjectRef } from "@shared/types/ipcEvents";
import type { DevModeSaveProjectRef } from "@shared/types/devModeSave";
import { getInterface } from "@/lib/app/bridge";
import { AppHost, AppProtocol } from "@shared/types/constants";
import { useTranslation } from "@/lib/i18n";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    BlueprintRuntimeDebugPanel,
    DEFAULT_OUTPUT_LOG_LEVELS,
    type BlueprintOutputLogLevel,
} from "./BlueprintRuntimeDebugPanel";
import { DevModeWidgetHighlight } from "./DevModeWidgetHighlight";
import { DevModeSafeAreaOverlay } from "./DevModeSafeAreaOverlay";
import { isSafeAreaPresetId } from "@/lib/ui-editor/preview/surfacePreviewFrames";
import { DEFAULT_GAME_RUNTIME_VIEWPORT_CONFIG } from "@shared/types/gameRuntime";
import { StoryRuntimeDebugPanel } from "./StoryRuntimeDebugPanel";
import { SavesDebugPanel } from "./SavesDebugPanel";
import { BlueprintDebuggerProvider } from "./debugger/BlueprintDebuggerContext";
import { BlueprintDebuggerOverlay } from "./debugger/BlueprintDebuggerOverlay";
import { BlueprintDebuggerPanel } from "./debugger/BlueprintDebuggerPanel";
import type { DevModePanelChrome } from "./DevModePanelChrome";
import { GameApp } from "@/lib/ui-editor/runtime/app/GameApp";
import type {
    GameAppBootAction,
    GameAppFrameContext,
    GameAppHost,
    GameAppOverlayContext,
    GameAppSaveBridge,
    GameAppSaveStore,
    GameAppStoryRuntimeBridge,
} from "@/lib/ui-editor/runtime/app/GameAppHost";
import { RuntimePluginHostController } from "@/lib/ui-editor/runtime/plugins/runtimePluginHostController";
import { blockIdForActionId, resolveSceneIdForBlock } from "./storyRuntimeDebugModel";
import { RuntimeIssueStrip } from "./RuntimeIssueStrip";
import { RuntimeIssuesPanel } from "./RuntimeIssuesPanel";
import {
    appendRuntimeIssue,
    blueprintDebugEventIssue,
    locateRuntimeIssue,
    runtimeIssueKey,
    type LocatedRuntimeIssue,
} from "./runtimeIssueModel";
import { formatKeybinding } from "@/lib/workspace/services/ui/keybindingFormat";
import { isMacPlatform } from "@/lib/app/platform";
import { useDevModeRuntimePlugins } from "../hooks/useDevModeRuntimePlugins";
import { resolveDevModeViewportSize } from "./devModeViewport";
import { createDevModePuppetHost, listDevModePuppetBackendModules } from "../devModePuppetHost";
import { registerDevModePuppetHost } from "@/lib/ui-editor/runtime/game/surfacePuppetHosts";

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

/**
 * One panel per SUBJECT. `issues` is what has gone wrong, `story` the running story, `interface` the
 * running UI, `saves` what is on disk and the project-wide persistent store, `debugger` stopped
 * execution — the last one is separate because a thing that halts the game and decides what gets
 * recorded is an instrument, not a subject.
 */
type DevModeDebugPanelId = "none" | "issues" | "interface" | "story" | "saves" | "debugger";

/**
 * Toggles the debug FAB back after it has been hidden.
 *
 * The menu item that hides it shows this chord beside itself, which is the whole reason hiding is
 * safe to offer: the author reads the way back at the moment they take the button away. `mod+` is
 * the shape the run area's other binding already uses (fast-forward is `mod+arrowright`).
 */
const DEBUG_FAB_TOGGLE_BINDING = "mod+shift+d";

/** Fast-forward to the next choice — shown beside its menu item for the same reason. */
const FAST_FORWARD_BINDING = "mod+arrowright";

/** Nothing acknowledged yet. One frozen instance so a reset is not a new object every time. */
const NO_ACKNOWLEDGED_KEYS: ReadonlySet<string> = new Set();

/** Width the debug drawer takes off the stage while it is open. */
const DEBUG_PANEL_WIDTH = 380;

/** Gap kept between a floating panel and the edge of the run area, and the clamp it is held to. */
const FLOAT_PANEL_MARGIN = 16;

/**
 * How tall a floating panel is: tall enough to read a timeline in, short enough that it can still be
 * moved vertically. `h-full` would be a panel that floats and cannot be dragged out of the way in
 * the one axis that matters.
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
    /** Save slots for the Saves panel, on the game's own Save/Load paths. */
    saves: GameAppSaveBridge;
    /** Owned by DevModeContent so the drawer survives a game-session remount (every timeline jump). */
    activePanel: DevModeDebugPanelId;
    setActivePanel: (update: (previous: DevModeDebugPanelId) => DevModeDebugPanelId) => void;
    /** Dock/float mode, owned at the same level and for the same reason as `activePanel`. */
    panelFloating: boolean;
    setPanelFloating: Dispatch<SetStateAction<boolean>>;
    floatPosition: FloatPanelPosition;
    setFloatPosition: Dispatch<SetStateAction<FloatPanelPosition>>;
    /** Which log levels the Output list shows AND records; owned above for the reason below. */
    outputLogLevels: ReadonlySet<BlueprintOutputLogLevel>;
    setOutputLogLevels: Dispatch<SetStateAction<ReadonlySet<BlueprintOutputLogLevel>>>;
    /** Everything that has gone wrong, for the Issues panel. Owned above, and cleared on reload. */
    sessionError: string | null;
    onDismissSessionError: () => void;
    issues: readonly LocatedRuntimeIssue[];
    onDismissIssue: (id: string) => void;
    onDismissAllIssues: () => void;
    /** Whether the debug FAB is hidden for this window; same owner and reason as `activePanel`. */
    fabHidden: boolean;
    setFabHidden: Dispatch<SetStateAction<boolean>>;
    /** Safe-area preset the stage overlay is drawing; owned above, picked in the Interface panel. */
    safeAreaId: string | null;
    setSafeAreaId: Dispatch<SetStateAction<string | null>>;
}) {
    const {
        core, bundle, uidoc, activeSurfaceId, widgetRuntimeStore, projectPath, fastForwardToNextChoice, storyRuntime,
        saves,
        activePanel, setActivePanel,
        panelFloating, setPanelFloating, floatPosition, setFloatPosition,
        outputLogLevels, setOutputLogLevels,
        sessionError, onDismissSessionError, issues, onDismissIssue, onDismissAllIssues,
        fabHidden, setFabHidden,
        safeAreaId, setSafeAreaId,
    } = props;
    const { t } = useTranslation();
    const [devtoolsMenuOpen, setDevtoolsMenuOpen] = useState(false);
    const [fastForwarding, setFastForwarding] = useState(false);
    const devtoolsFabRef = useRef<HTMLButtonElement>(null);
    const devtoolsMenuRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    /** Where the panel is being dragged to right now; `null` whenever no drag is in flight. */
    const [dragPosition, setDragPosition] = useState<FloatPanelPosition>(null);
    /**
     * The widget the drawer is currently pointing at, drawn over the stage. Owned here because the
     * highlight is a sibling of the panel that asks for it, not a child of it.
     */
    const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
    /** Tears down an in-flight title-bar drag (also on unmount, so no listener outlives the panel). */
    const endDragRef = useRef<(() => void) | null>(null);
    useEffect(() => () => endDragRef.current?.(), []);
    const activeFloatPosition = dragPosition ?? floatPosition;

    /**
     * Arm verbose capture from the author's log-level choice.
     *
     * Verbose tracing is dropped at the DebugBridge unless something asks for it (it fires at least
     * twice per executed node), so the level selection has to drive what is RECORDED and not just
     * what the Output list shows.
     *
     * That is why this lives out here beside the stage rather than in the panel that owns the
     * checkbox. The panel is unmounted the moment the drawer is closed, and it used to turn capture
     * off on the way out: closing the drawer silently stopped recording, and every verbose event
     * emitted while it was closed was gone for good — a view deciding what the session records.
     *
     * There is deliberately no cleanup that turns it off. Each GameApp session builds its own
     * DebugBridge (`useBlueprintRuntimeCore`) and the old one is discarded with the session, so the
     * only thing an off-on-unmount could do is reintroduce the same bug one level up. Re-running on
     * `core.debug` is what re-arms the NEW bridge after a timeline jump, which is the same reason
     * `activePanel` is hoisted (see its declaration).
     */
    useEffect(() => {
        core.debug.setVerboseCaptureEnabled(outputLogLevels.has("verbose"));
    }, [core.debug, outputLogLevels]);

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
            const document = bundle.storyLibrary?.documents[context.storyId];
            const sceneId = document
                ? resolveSceneIdForBlock(document, blockId, context.sceneId)
                : context.sceneId;
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
            // Ctrl/Cmd + Shift + D : show or hide the debug button. Listened for whether or not it
            // is currently hidden, because getting it BACK is the only thing this binding is for.
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
                e.preventDefault();
                setDevtoolsMenuOpen(false);
                setFabHidden(previous => !previous);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [handleFastForward, setFabHidden]);

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

    /**
     * The drawer's subjects, in menu order.
     *
     * One list rather than a menu tuple beside an aria-label switch: the panel's accessible name IS
     * the name the author picked it by, and two places deriving it separately is how one of them
     * ends up naming a panel the drawer is no longer showing.
     */
    const panels = useMemo(
        () => ([
            // First because it is the one an author is sent to rather than one they go looking for:
            // the strip at the top of the window opens it.
            ["issues", t("devMode.issues.title")],
            ["story", t("devMode.runtime.title")],
            ["interface", t("devMode.devtools.title")],
            ["saves", t("devMode.saves.title")],
            ["debugger", t("devMode.debugger.title")],
        ] as [Exclude<DevModeDebugPanelId, "none">, string][]),
        [t],
    );
    const activePanelLabel = panels.find(([id]) => id === activePanel)?.[1] ?? "";

    // Rendered once for the platform rather than per item: the chord a menu shows has to be the one
    // the key handler above actually listens for, and `mod` is not what either of them is called.
    const shortcuts = useMemo(() => {
        const mac = isMacPlatform();
        return {
            fastForward: formatKeybinding(FAST_FORWARD_BINDING, mac),
            hideFab: formatKeybinding(DEBUG_FAB_TOGGLE_BINDING, mac),
        };
    }, []);

    return (
        <BlueprintDebuggerProvider
            session={core.debugSession}
            blueprintDocument={bundle.ui.localBlueprints}
            projectPath={projectPath}
        >
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
                        aria-label={activePanelLabel}
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
                            {activePanel === "issues" ? (
                                <RuntimeIssuesPanel
                                    sessionError={sessionError}
                                    onDismissSessionError={onDismissSessionError}
                                    issues={issues}
                                    onDismissIssue={onDismissIssue}
                                    onDismissAllIssues={onDismissAllIssues}
                                    projectPath={projectPath}
                                    className="h-full min-h-0 w-full"
                                    chrome={panelChrome}
                                />
                            ) : activePanel === "debugger" ? (
                                <BlueprintDebuggerPanel className="h-full min-h-0 w-full" chrome={panelChrome} />
                            ) : activePanel === "story" ? (
                                <StoryRuntimeDebugPanel
                                    storyRuntime={storyRuntime}
                                    scopeBridge={core.scopeBridge}
                                    bundle={bundle}
                                    className="h-full min-h-0 w-full"
                                    chrome={panelChrome}
                                />
                            ) : activePanel === "saves" ? (
                                <SavesDebugPanel
                                    saves={saves}
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
                                    outputLogLevels={outputLogLevels}
                                    setOutputLogLevels={setOutputLogLevels}
                                    onHighlightElement={setHighlightedElementId}
                                    safeAreaId={safeAreaId}
                                    setSafeAreaId={setSafeAreaId}
                                    className="h-full min-h-0 w-full"
                                    chrome={panelChrome}
                                />
                            )}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            {/* Hidden means gone, not faded: a ghost circle still sits on top of the game, which is
                the complaint. The chord in the menu item is the way back, and it is listened for
                above whether the button is on screen or not. */}
            <div className={`pointer-events-none absolute inset-0 z-40 ${fabHidden ? "hidden" : ""}`}>
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
                                    <span className="shrink-0 text-2xs text-fg-subtle">{shortcuts.fastForward}</span>
                                </button>
                                {panels.map(([id, label]) => {
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
                                {/* Below the rule because it is not another view of the game: it
                                    takes the button itself away. */}
                                <div className="my-1 h-px bg-edge" aria-hidden />
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="flex w-full cursor-default items-center gap-2 px-3 py-2 text-left text-xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                                    onClick={() => {
                                        setDevtoolsMenuOpen(false);
                                        setFabHidden(true);
                                    }}
                                >
                                    <span
                                        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                                        aria-hidden
                                    >
                                        <EyeOff className="h-3.5 w-3.5" />
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">{t("devMode.devtools.hide")}</span>
                                    <span className="shrink-0 text-2xs text-fg-subtle">{shortcuts.hideFab}</span>
                                </button>
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

            {/* Over the stage, and over the drawer: while stopped, the graph is the window. */}
            <BlueprintDebuggerOverlay />

            {/* Last, and above everything else here: a highlight that something else can cover is a
                highlight that fails on exactly the widget worth pointing at. */}
            <DevModeWidgetHighlight elementId={highlightedElementId} />
        </BlueprintDebuggerProvider>
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

    const log = useCallback<GameAppHost["log"]>((level, message) => {
        if (level === "error") {
            console.error(message);
        } else if (level === "warning") {
            console.warn(message);
        } else {
            console.info(message);
        }
    }, []);

    /**
     * Failures the running game reported, located against the story that is open.
     *
     * Kept here rather than inside the banner because a bundle reload has to clear it: the issues
     * describe rows in a document that has just been replaced, and a stale "line 37" pointing into
     * the previous revision is worse than no line at all.
     */
    const [runtimeIssues, setRuntimeIssues] = useState<readonly LocatedRuntimeIssue[]>([]);
    /**
     * What the strip has already announced.
     *
     * Taking the strip down is an acknowledgement and NOT a delete — the Issues panel keeps every
     * entry, and clearing the report is a deliberate act performed there. So the two need separate
     * state, and this is the half the strip owns.
     *
     * Held as problem KEYS rather than entry ids because a row inside a loop reports the same
     * failure on every pass, each report being a new entry (`appendRuntimeIssue` collapses them by
     * exactly this key). Acknowledging by entry would put the strip back a frame after it was
     * dismissed, for the whole time the loop runs.
     */
    const [acknowledgedKeys, setAcknowledgedKeys] = useState<ReadonlySet<string>>(NO_ACKNOWLEDGED_KEYS);
    const [acknowledgedSessionError, setAcknowledgedSessionError] = useState<string | null>(null);
    // A plain counter, not a timestamp: two issues reported inside the same millisecond would share
    // a key, and React would treat the second as the first.
    const issueSeqRef = useRef(0);
    const bundleRef = useRef(bundle);
    bundleRef.current = bundle;
    const reportIssue = useCallback<NonNullable<GameAppHost["reportIssue"]>>(issue => {
        const current = bundleRef.current;
        if (!current) {
            return;
        }
        issueSeqRef.current += 1;
        const located = locateRuntimeIssue(current, issue, `issue-${issueSeqRef.current}`);
        setRuntimeIssues(previous => appendRuntimeIssue(previous, located));
    }, []);

    /**
     * The blueprint debug stream, which this window both forwards and reads.
     *
     * Reading it is the half that was missing. A node that threw emitted `execution.error` and
     * nothing else: the event went over IPC to the Workspace console in the OTHER window, so a Game
     * UI failure — a quick menu button, a dialogue box, a choice list — left this window saying
     * "nothing has failed" while the button did nothing. The author's only signal was the silence.
     *
     * Both halves stay: the Workspace console is where an author reads a whole session's trace, and
     * the Issues panel is where they are told something is wrong right now.
     */
    const onDebugEvent = useCallback((event: BlueprintDebugEvent) => {
        const issue = blueprintDebugEventIssue(event);
        if (issue) {
            reportIssue(issue);
        }
        if (!projectPath) {
            return;
        }
        try {
            getInterface().devMode.forwardBlueprintDebugEvent({ projectPath, event });
        } catch (error) {
            console.warn("[DevMode] failed to forward blueprint debug event", error);
        }
    }, [projectPath, reportIssue]);
    useEffect(() => {
        setRuntimeIssues([]);
        setAcknowledgedKeys(NO_ACKNOWLEDGED_KEYS);
        setAcknowledgedSessionError(null);
    }, [bundle?.bundleId, bundle?.revision]);
    const dismissIssue = useCallback((id: string) => {
        setRuntimeIssues(previous => previous.filter(issue => issue.id !== id));
    }, []);
    const dismissAllIssues = useCallback(() => setRuntimeIssues([]), []);

    // Acknowledgement follows the list down: a problem cleared from the panel is no longer
    // acknowledged, so the strip speaks up again if it comes back. Without this, an entry dismissed
    // by hand would be silently muted for the rest of the session.
    useEffect(() => {
        setAcknowledgedKeys(previous => {
            if (previous.size === 0) {
                return previous;
            }
            const live = new Set(runtimeIssues.map(runtimeIssueKey));
            const next = new Set([...previous].filter(key => live.has(key)));
            return next.size === previous.size ? previous : next;
        });
    }, [runtimeIssues]);

    /** The failures the strip still has to announce, and the session error if it has not seen it. */
    const pendingIssues = useMemo(
        () => runtimeIssues.filter(issue => !acknowledgedKeys.has(runtimeIssueKey(issue))),
        [runtimeIssues, acknowledgedKeys],
    );
    const pendingSessionError = sessionError !== null && sessionError !== acknowledgedSessionError
        ? sessionError
        : null;
    const dismissStrip = useCallback(() => {
        setAcknowledgedKeys(new Set(runtimeIssues.map(runtimeIssueKey)));
        setAcknowledgedSessionError(sessionError);
    }, [runtimeIssues, sessionError]);

    const resolveStoryAssetUrl = useCallback<GameAppHost["resolveStoryAssetUrl"]>(async (assetId, assetType) => {
        const result = await getInterface().devMode.resolveAssetUrl(assetId, assetType);
        if (!result.success || !result.data?.url) {
            throw new Error(result.error ?? `Failed to resolve asset: ${assetId}`);
        }
        return result.data.url;
    }, []);

    /**
     * Author-supplied puppet backends, read straight out of the open project.
     *
     * The reading itself lives in `devModePuppetHost.ts` because a Surface `nl.puppet` widget needs the
     * identical lookup with no stage in sight, and two copies would drift with only this one exercised
     * by launching a story.
     */
    const listPuppetBackendModules = useCallback(
        () => listDevModePuppetBackendModules(projectPath),
        [projectPath],
    );

    /**
     * The same lookup, published for anything in this window that is not the stage.
     *
     * A Surface puppet widget is mounted deep inside a `GameApp` surface tree that knows nothing about
     * this component, so it reads the resolver out of a module-level registry rather than receiving it
     * — the shape `getGameRuntimeBridge()` and `resolveCharacterAvatarAssetUrl()` already use. Torn
     * down on project change so a relaunch against a different project cannot be served by the previous
     * one's grants.
     */
    useEffect(
        () => registerDevModePuppetHost(createDevModePuppetHost(projectPath)),
        [projectPath],
    );

    const requireProjectRef = useCallback((operation: string): DevModeSaveProjectRef => {
        if (!projectRef) {
            throw new Error(`${operation}: project is not available`);
        }
        return projectRef;
    }, [projectRef]);

    /**
     * The Fetch node's request, handed to the main process.
     *
     * The project path travels with it because the handler reads the project's own Allow HTTP
     * setting off disk rather than trusting anything sent from here - this window is the one the
     * setting is meant to constrain.
     */
    const networkFetch = useCallback<NonNullable<GameAppHost["networkFetch"]>>(async request => {
        if (!projectPath) {
            return {
                outcome: "networkError",
                status: 0,
                body: null,
                error: "Fetch: no project is open",
            };
        }
        const result = await getInterface().blueprintNetwork.fetch(projectPath, request);
        if (!result.success) {
            // The channel itself failed, which is Studio malfunctioning rather than the request
            // failing. Reported on the node's error branch anyway: the graph has to go somewhere.
            return {
                outcome: "networkError",
                status: 0,
                body: null,
                error: result.error ?? "Fetch failed",
            };
        }
        return result.data.result;
    }, [projectPath]);

    /**
     * The Open Link node's request, handed to the main process.
     *
     * The project path travels with it because the handler reads the project's own declared
     * addresses off disk and refuses anything else - the same refusal the shipped game makes, in
     * the same kind of process. Nothing here consults Studio's own external-link path.
     */
    const openExternal = useCallback<NonNullable<GameAppHost["openExternal"]>>(async request => {
        if (!projectPath) {
            return { outcome: "failed", error: "Open Link: no project is open" };
        }
        const result = await getInterface().blueprintExternalLink.open(projectPath, request);
        if (!result.success) {
            // The channel itself failed, which is Studio malfunctioning rather than the link being
            // refused. Reported on the node's failure branch anyway: the graph has to go somewhere.
            return { outcome: "failed", error: result.error ?? "Open Link failed" };
        }
        return result.data.result;
    }, [projectPath]);

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
        // Forwarded, never decided here. The main process looks the plugin up in the install
        // registry and checks that plugin's own declared patterns - the same manifest the packaged
        // game reads out of its pack - so a preview opens exactly what the shipped game opens.
        navigation: {
            openExternal: async (ownerPluginId, request) => {
                const result = await getInterface().blueprintExternalLink
                    .openForPlugin(ownerPluginId, request);
                if (!result.success) {
                    // The channel failed, which is Studio malfunctioning rather than the address
                    // being refused. Reported as a failure so a plugin tells the two apart.
                    return { outcome: "failed", error: result.error ?? "Open Link failed" };
                }
                return result.data.result;
            },
        },
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
            debuggerEnabled: true,
            disposeMessage: "Dev Mode runtime disposed",
            log,
            reportIssue,
            resolveStoryAssetUrl,
            saveStore,
            listPuppetBackendModules,
            quitApplication,
            getFullscreen,
            setFullscreen,
            subscribeFullscreenChanged,
            subscribeCloseRequested,
            networkFetch,
            openExternal,
        };
    }, [
        bootAction,
        bundle,
        getFullscreen,
        log,
        networkFetch,
        openExternal,
        onDebugEvent,
        persistenceAdapter,
        quitApplication,
        listPuppetBackendModules,
        reportIssue,
        resolveStoryAssetUrl,
        runtimePlugins.ready,
        saveStore,
        setFullscreen,
        subscribeFullscreenChanged,
        subscribeCloseRequested,
        surface,
    ]);

    const getScale = useCallback(() => scale, [scale]);

    /**
     * Safe-area device preset for this window, `null` = off.
     *
     * Scoped to the Dev Mode session and nothing wider: seeded once from the launch entry (only the
     * UI editor's canvas launch button sends one) and then owned by the Interface panel's picker.
     * Never written back — the editor's canvas frame and what this window is showing are two
     * separate decisions, and a window that silently rewrote the editor's choice would be the more
     * surprising of the two.
     *
     * Owned here for the same reason as `activePanel` below: the panel that draws the picker is
     * unmounted whenever the drawer closes, and a timeline jump remounts the whole session.
     * Declared above `renderFrame` because that callback lists it as a dependency.
     */
    const [safeAreaId, setSafeAreaId] = useState<string | null>(null);
    const safeAreaSeededRef = useRef(false);
    useEffect(() => {
        // `entry` arrives a tick after mount (it comes from the window props), so this cannot be a
        // `useState` initializer. Seeded once: after that the picker owns the value, and a re-render
        // carrying the same entry must not undo the author's choice.
        if (safeAreaSeededRef.current || !entry) {
            return;
        }
        safeAreaSeededRef.current = true;
        if (entry.kind === "surface" && isSafeAreaPresetId(entry.safeAreaId)) {
            setSafeAreaId(entry.safeAreaId ?? null);
        }
    }, [entry]);

    /**
     * The project's stage fit, forwarded on the launch entry by both launch paths.
     *
     * Dev Mode crops for real rather than approximating it: this window exists to show the author
     * what a player gets, and an author who cannot see the crop until they build a phone package
     * cannot iterate on where it lands. A pack that predates the field reads as `contain`.
     */
    const stageViewport = useMemo(() => {
        const config = entry?.kind === "surface" ? entry.viewport : undefined;
        const resolved = config ?? DEFAULT_GAME_RUNTIME_VIEWPORT_CONFIG;
        return {
            fit: resolved.fit,
            cropAnchor: { x: resolved.cropAnchorX, y: resolved.cropAnchorY },
        };
    }, [entry]);

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
                        fit={stageViewport.fit}
                        cropAnchor={stageViewport.cropAnchor}
                    >
                        {ctx.children}
                        {/* Inside the box, so it covers the stage and not the letterbox bars. */}
                        <DevModeSafeAreaOverlay
                            designSize={viewportSize}
                            safeAreaId={safeAreaId}
                            mobileOrientation={entry?.kind === "surface" ? entry.mobileOrientation : undefined}
                        />
                    </StageViewportFrame>
                </div>
            </div>
        );
    }, [entry, handleAspectUpdate, safeAreaId, stageViewport]);

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
    /**
     * Which log levels the Output list shows — and, for `verbose`, what the session RECORDS.
     *
     * Owned here rather than in the panel that draws the checkboxes, because it is not a view
     * setting: turning verbose on arms capture at the DebugBridge, and a choice that decides what
     * gets recorded cannot belong to a view that is unmounted every time the drawer is closed. See
     * the effect in `DevModeDebugOverlay` for what closing it used to cost. Hoisted to the same
     * owner as `activePanel` and for the same second reason: a timeline jump replaces the whole
     * session, and a selection that reset there would silently stop recording mid-investigation.
     */
    const [outputLogLevels, setOutputLogLevels] = useState<ReadonlySet<BlueprintOutputLogLevel>>(
        () => new Set(DEFAULT_OUTPUT_LOG_LEVELS),
    );
    /**
     * Whether the debug button is hidden, for this window and no longer.
     *
     * Same owner as `activePanel` so a timeline jump does not put it back under an author who just
     * took it away, and deliberately not persisted: a Dev Mode window that opens with no visible way
     * into the debug tools is a window whose only affordance is a chord nobody has been shown yet.
     */
    const [fabHidden, setFabHidden] = useState(false);

    /**
     * The strip's way in.
     *
     * Deliberately does not put a hidden debug button back: hiding it was a decision about what may
     * cover the game, and the drawer this opens closes on Escape like every other panel here.
     */
    const openIssues = useCallback(() => setActivePanel("issues"), []);

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
                saves={ctx.saves}
                activePanel={activePanel}
                setActivePanel={setActivePanel}
                panelFloating={panelFloating}
                setPanelFloating={setPanelFloating}
                floatPosition={floatPosition}
                setFloatPosition={setFloatPosition}
                outputLogLevels={outputLogLevels}
                setOutputLogLevels={setOutputLogLevels}
                sessionError={sessionError}
                onDismissSessionError={onDismissSessionError}
                issues={runtimeIssues}
                onDismissIssue={dismissIssue}
                onDismissAllIssues={dismissAllIssues}
                fabHidden={fabHidden}
                setFabHidden={setFabHidden}
                safeAreaId={safeAreaId}
                setSafeAreaId={setSafeAreaId}
            />
        );
    }, [
        bundle,
        projectPath,
        activePanel,
        panelFloating,
        floatPosition,
        outputLogLevels,
        sessionError,
        onDismissSessionError,
        runtimeIssues,
        dismissIssue,
        dismissAllIssues,
        fabHidden,
        safeAreaId,
    ]);

    if (!bundle || !host) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                {/* No session, so no drawer: the strip carries the failure itself here. */}
                <RuntimeIssueStrip
                    sessionError={pendingSessionError}
                    issues={pendingIssues}
                    onDismiss={dismissStrip}
                    onOpenIssues={null}
                />
                <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
                    {t("devMode.waitingPayload")}
                </div>
            </div>
        );
    }

    if (!surface) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <RuntimeIssueStrip
                    sessionError={pendingSessionError}
                    issues={pendingIssues}
                    onDismiss={dismissStrip}
                    onOpenIssues={null}
                />
                <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
                    {t("devMode.surfaceNotFound", { surfaceId })}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
            {/* One line, never more: what went wrong is read in the Issues panel this opens, which
                takes width from the stage instead of height off the top of it. */}
            <RuntimeIssueStrip
                sessionError={pendingSessionError}
                issues={pendingIssues}
                onDismiss={dismissStrip}
                onOpenIssues={openIssues}
            />
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
