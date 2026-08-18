import React, { useState, useCallback, useEffect, useRef } from "react";
import { PanelBottom, PanelLeft, PanelRight } from "lucide-react";
import { TitleBar, windowRootProps } from "@/lib/components/layout";
import { TooltipHost } from "@/lib/tooltip";
import { LeftSidebarSelector } from "./LeftSidebarSelector";
import { BottomPanelSelector } from "./BottomPanelSelector";
import { RightSidebarSelector } from "./RightSidebarSelector";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { BottomPanel } from "./BottomPanel";
import { MainEditorArea } from "./MainEditorArea";
import { ActionBar } from "./ActionBar";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ControlBar } from "./ControlBar";
import { NotificationContainer } from "../ui/NotificationContainer";
import { DialogContainer } from "../ui/DialogContainer";
import { ResizableHandle } from "../ui/ResizableHandle";
import { EditorClosedTabsKeybinding } from "./EditorClosedTabsKeybinding";
import { WorkspaceUndoKeybindings } from "./WorkspaceUndoKeybindings";
import { WorkspaceHistoryMenu } from "./WorkspaceHistoryMenu";
import { WorkspaceEditorQuickSwitch } from "./WorkspaceEditorQuickSwitch";
import { CommandPalette } from "./CommandPalette";
import { EditorCommands } from "./EditorCommands";
import { WorkspaceFreezeCommands } from "./WorkspaceFreezeCommands";
import { LintCommands } from "../../modules/lint/LintCommands";
import { StoryScriptCommands } from "../../modules/story/script/StoryScriptCommands";
import { NarralangCommands } from "../../modules/story/narralang/NarralangCommands";
import { WorkspaceCommands } from "./WorkspaceCommands";
import { KeybindingCheatSheet } from "./KeybindingCheatSheet";
import { WorkspaceHelp } from "./WorkspaceHelp";
import { TitleBarSearchBox } from "./TitleBarSearchBox";
import { StatusBar, STATUS_BAR_HEIGHT } from "./StatusBar";
import { QuickOpenPicker } from "./QuickOpenPicker";
import { BackgroundImageDialog } from "./BackgroundImageDialog";
import { useWorkspaceBackgroundImage } from "./useWorkspaceBackgroundImage";
import { backgroundLayerStyle } from "@/lib/workspace/services/ui/backgroundSettings";
import { useRegistry } from "../../registry";
import { PanelPosition, type PanelDefinition } from "../../registry/types";
import { useWorkspace } from "../../context";
import { RecoveryBanner } from "../../recovery/RecoveryBanner";
import { ExperimentalNotice } from "../../experimental/ExperimentalNotice";
import { RECOVERY_PANEL_ID } from "../../modules/recovery";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { getInterface } from "@/lib/app/bridge";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { isMacPlatform } from "@/lib/app/platform";
import { useTranslation } from "@/lib/i18n";
import { WorkspaceMenuAction } from "@shared/types/menu";
import {
    DOCK_REGIONS,
    EDITOR_FLOOR,
    applyResize,
    railColumnOffsets,
    resolveDock,
    type DockEnv,
} from "./dockLayoutModel";
import { DEFAULT_COLLAPSED_PANEL_IDS } from "./sidebarPanelGroup";
import { VersionRail } from "./VersionRail";
import { resolveVersionRailPresence, versionRailWidth } from "./versionRailModel";
import { useVersionSurface } from "../../hooks/useVersionSurface";

interface WorkspaceLayoutProps {
    title: string;
    iconSrc: string;
}


// Region sizing lives in ./dockLayoutModel (constraint table + solver). The persisted values
// below are the user's *intended* sizes; the *effective* rendered sizes are derived each render
// via resolveDock(), so nothing is mutated on window resize.

// Settings keys for persistence
const SETTINGS_KEYS = {
    LEFT_SIDEBAR_VISIBLE: "ui.leftSidebar.visible",
    LEFT_SIDEBAR_WIDTH: "ui.leftSidebar.width",
    LEFT_SIDEBAR_ACTIVE_PANEL: "ui.leftSidebar.activePanel",
    LEFT_SIDEBAR_ORDER: "ui.leftSidebar.order",
    LEFT_SIDEBAR_COLLAPSED: "ui.leftSidebar.collapsed",
    RIGHT_SIDEBAR_VISIBLE: "ui.rightSidebar.visible",
    RIGHT_SIDEBAR_WIDTH: "ui.rightSidebar.width",
    RIGHT_SIDEBAR_ACTIVE_PANEL: "ui.rightSidebar.activePanel",
    RIGHT_SIDEBAR_ORDER: "ui.rightSidebar.order",
    BOTTOM_PANEL_VISIBLE: "ui.bottomPanel.visible",
    BOTTOM_PANEL_HEIGHT: "ui.bottomPanel.height",
    BOTTOM_PANEL_ACTIVE_PANEL: "ui.bottomPanel.activePanel",
    BOTTOM_PANEL_ORDER: "ui.bottomPanel.order",
    // The version rail's own state. Persisted like every other dock preference, and NOT with the
    // freeze: a rail expanded because the author was reading history should still be expanded next
    // launch, while the freeze itself is never persisted (a project that refuses to save with no
    // visible cause - see WorkspaceFreezeService).
    VERSION_RAIL_EXPANDED: "ui.versionRail.expanded",
};

const ORDER_SETTINGS_KEY_BY_POSITION: Record<PanelPosition, string> = {
    [PanelPosition.Left]: SETTINGS_KEYS.LEFT_SIDEBAR_ORDER,
    [PanelPosition.Right]: SETTINGS_KEYS.RIGHT_SIDEBAR_ORDER,
    [PanelPosition.Bottom]: SETTINGS_KEYS.BOTTOM_PANEL_ORDER,
};

const REMOVED_PANEL_IDS = new Set(["narraleaf-studio:running-tasks"]);

/** The dock toggles this layout publishes; a private id, since the group declares its own slot. */
const PANEL_TOGGLES_GROUP_ID = "narraleaf-studio:window-panels";

function normalizeStoredPanelId(panelId: string | null | undefined): string | null | undefined {
    if (panelId && REMOVED_PANEL_IDS.has(panelId)) {
        return null;
    }
    return panelId;
}

/**
 * Main workspace layout container
 * Provides VSCode/IDEA-like layout with:
 * - Title bar containing action bar (left) and control bar (right) with window controls
 * - Left sidebar with selector (resizable)
 * - Right sidebar with selector (resizable)
 * - Bottom panel with selector (resizable)
 * - Main editor area with tabs and split support
 */
export function WorkspaceLayout({ title, iconSrc }: WorkspaceLayoutProps) {
    const { getPanelsByPosition, registerActionGroup, unregisterActionGroup } = useRegistry();
    const { context, recovery } = useWorkspace();
    const { t } = useTranslation();

    // Sidebar visibility states
    const [leftSidebarVisible, setLeftSidebarVisible] = useState(false);
    const [rightSidebarVisible, setRightSidebarVisible] = useState(false);
    const [bottomPanelVisible, setBottomPanelVisible] = useState(false);

    // Active panel IDs
    const [activeLeftPanelId, setActiveLeftPanelId] = useState<string | null>(null);
    const [activeRightPanelId, setActiveRightPanelId] = useState<string | null>(null);
    const [activeBottomPanelId, setActiveBottomPanelId] = useState<string | null>(null);

    // User-defined panel ordering per dock area (mirror of UIStore, persisted here)
    const [panelOrders, setPanelOrders] = useState<Partial<Record<PanelPosition, string[]>>>({});
    // Panels folded into the left rail's collapse group (mirror of UIStore, persisted here)
    const [collapsedLeftPanels, setCollapsedLeftPanels] = useState<string[] | null>(null);

    // The version rail: the leftmost column, the one fixed column whose width changes, and the one
    // that is usually not there at all. Owned here rather than by the rail itself because the dock
    // solver has to be told about it — an unaccounted column squeezes the editor below its floor and
    // the overflow loops (see DockEnv.versionRailWidth).
    const [versionRailExpanded, setVersionRailExpanded] = useState(false);
    // One reader shared by the rail and the switcher menu, so the two can never disagree about
    // which version this window is a view of.
    const versionSurface = useVersionSurface();

    // Intended region sizes (the user's last drag target). Effective rendered sizes are derived
    // from these via resolveDock() below — these are never mutated on window resize.
    const [leftSidebarWidth, setLeftSidebarWidth] = useState(DOCK_REGIONS.left.default);
    const [rightSidebarWidth, setRightSidebarWidth] = useState(DOCK_REGIONS.right.default);
    const [bottomPanelHeight, setBottomPanelHeight] = useState(DOCK_REGIONS.bottom.default);

    // Status bar visibility (global setting); its height is only carved out of the dock layout
    // while it is actually shown.
    const [statusBarVisible, setStatusBarVisible] = useState(true);
    // The title-bar search box is optional too; hiding it moves the palette's input into its own card.
    const [titleBarSearchVisible, setTitleBarSearchVisible] = useState(true);
    useEffect(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        setStatusBarVisible(settings.getSync("ui.statusBar.visible") !== false);
        setTitleBarSearchVisible(settings.getSync("ui.titleBarSearch.visible") !== false);
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === "ui.statusBar.visible") {
                setStatusBarVisible(change.value !== false);
            }
            if (change.key === "ui.titleBarSearch.visible") {
                setTitleBarSearchVisible(change.value !== false);
            }
        });
        return () => token?.cancel();
    }, [context]);
    const statusBarHeight = statusBarVisible ? STATUS_BAR_HEIGHT : 0;

    // Live viewport dimensions; drives the derived effective sizes so the layout reflows with the
    // window. Height excludes the status bar — the dock solver lays out into what is left above it.
    const [viewport, setViewport] = useState(() => ({
        width: typeof window !== "undefined" ? window.innerWidth : 1280,
        height: (typeof window !== "undefined" ? window.innerHeight : 800) - STATUS_BAR_HEIGHT,
    }));

    // Refs mirror the intended sizes for synchronous reads during fast dragging.
    const leftSidebarWidthRef = useRef(DOCK_REGIONS.left.default);
    const rightSidebarWidthRef = useRef(DOCK_REGIONS.right.default);
    const bottomPanelHeightRef = useRef(DOCK_REGIONS.bottom.default);
    const activeLeftPanelIdRef = useRef<string | null>(null);
    const activeRightPanelIdRef = useRef<string | null>(null);
    const activeBottomPanelIdRef = useRef<string | null>(null);
    // Visibility mirrors, read by the resize handlers when computing cross-axis drag bounds.
    const leftSidebarVisibleRef = useRef(false);
    const rightSidebarVisibleRef = useRef(false);
    // The version rail's live width, for the same reason: a drag started while the rail is expanded
    // has to be bounded by the space the rail is actually taking, or the sidebar can be dragged over
    // the editor's floor.
    const versionRailWidthRef = useRef(0);

    // Settings service
    const settingsService = context?.services.get<GlobalSettingsService>(Services.GlobalSettings);

    // Track whether settings have been loaded
    const [settingsLoaded, setSettingsLoaded] = useState(false);

    // Debounced save settings to reduce file system access
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const debouncedSaveSettings = useCallback(async () => {
        // Clear existing timeout
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Set new timeout with 500ms delay
        saveTimeoutRef.current = setTimeout(async () => {
            if (!settingsService) return;
            // A recovery window never writes the dock layout back. It opens with a layout it chose
            // for itself (see the effect below) over a panel set that is deliberately almost empty,
            // and persisting that would hand the author's next ordinary session a workspace with one
            // panel in it - a second problem to solve, caused by looking at the first.
            if (recovery) return;

            try {
                const settings = {
                    [SETTINGS_KEYS.LEFT_SIDEBAR_VISIBLE]: leftSidebarVisible,
                    [SETTINGS_KEYS.LEFT_SIDEBAR_WIDTH]: leftSidebarWidth,
                    [SETTINGS_KEYS.LEFT_SIDEBAR_ACTIVE_PANEL]: activeLeftPanelId,
                    [SETTINGS_KEYS.LEFT_SIDEBAR_ORDER]: panelOrders[PanelPosition.Left] ?? null,
                    [SETTINGS_KEYS.LEFT_SIDEBAR_COLLAPSED]: collapsedLeftPanels,
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_VISIBLE]: rightSidebarVisible,
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_WIDTH]: rightSidebarWidth,
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_ACTIVE_PANEL]: activeRightPanelId,
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_ORDER]: panelOrders[PanelPosition.Right] ?? null,
                    [SETTINGS_KEYS.BOTTOM_PANEL_VISIBLE]: bottomPanelVisible,
                    [SETTINGS_KEYS.BOTTOM_PANEL_HEIGHT]: bottomPanelHeight,
                    [SETTINGS_KEYS.BOTTOM_PANEL_ACTIVE_PANEL]: activeBottomPanelId,
                    [SETTINGS_KEYS.BOTTOM_PANEL_ORDER]: panelOrders[PanelPosition.Bottom] ?? null,
                    [SETTINGS_KEYS.VERSION_RAIL_EXPANDED]: versionRailExpanded,
                };

                await settingsService.setBatch(settings);
            } catch (error) {
                console.error("Failed to save workspace layout settings:", error);
            }
        }, 500);
    }, [
        settingsService,
        leftSidebarVisible,
        leftSidebarWidth,
        activeLeftPanelId,
        rightSidebarVisible,
        rightSidebarWidth,
        activeRightPanelId,
        bottomPanelVisible,
        bottomPanelHeight,
        activeBottomPanelId,
        panelOrders,
        collapsedLeftPanels,
        versionRailExpanded,
        recovery,
    ]);

    /**
     * A recovery window opens on the recovery panel.
     *
     * The restored layout is about a project this window is not showing: it names the panel the
     * author last had open, and in this mode that panel is usually not registered at all, so the
     * sidebar restores to nothing and the one thing worth reading is behind an icon nobody has a
     * reason to click. Runs once settings have loaded so it wins over them, and writes nothing back.
     */
    useEffect(() => {
        if (!recovery || !settingsLoaded) {
            return;
        }
        setLeftSidebarVisible(true);
        setActiveLeftPanelId(RECOVERY_PANEL_ID);
    }, [recovery, settingsLoaded]);

    useEffect(() => {
        activeLeftPanelIdRef.current = activeLeftPanelId;
    }, [activeLeftPanelId]);

    useEffect(() => {
        activeRightPanelIdRef.current = activeRightPanelId;
    }, [activeRightPanelId]);

    useEffect(() => {
        activeBottomPanelIdRef.current = activeBottomPanelId;
    }, [activeBottomPanelId]);

    useEffect(() => {
        leftSidebarVisibleRef.current = leftSidebarVisible;
    }, [leftSidebarVisible]);

    useEffect(() => {
        rightSidebarVisibleRef.current = rightSidebarVisible;
    }, [rightSidebarVisible]);

    // Load saved state on mount
    useEffect(() => {
        if (!settingsService) return;

        const loadSettings = async () => {
            try {
                // Load sidebar visibility
                const leftVisible = await settingsService.get<boolean>(SETTINGS_KEYS.LEFT_SIDEBAR_VISIBLE);
                const rightVisible = await settingsService.get<boolean>(SETTINGS_KEYS.RIGHT_SIDEBAR_VISIBLE);
                const bottomVisible = await settingsService.get<boolean>(SETTINGS_KEYS.BOTTOM_PANEL_VISIBLE);

                // Load sidebar sizes
                const leftWidth = await settingsService.get<number>(SETTINGS_KEYS.LEFT_SIDEBAR_WIDTH);
                const rightWidth = await settingsService.get<number>(SETTINGS_KEYS.RIGHT_SIDEBAR_WIDTH);
                const bottomHeight = await settingsService.get<number>(SETTINGS_KEYS.BOTTOM_PANEL_HEIGHT);

                // Load active panels
                const leftPanel = normalizeStoredPanelId(await settingsService.get<string | null>(SETTINGS_KEYS.LEFT_SIDEBAR_ACTIVE_PANEL));
                const rightPanel = normalizeStoredPanelId(await settingsService.get<string | null>(SETTINGS_KEYS.RIGHT_SIDEBAR_ACTIVE_PANEL));
                const bottomPanel = normalizeStoredPanelId(await settingsService.get<string | null>(SETTINGS_KEYS.BOTTOM_PANEL_ACTIVE_PANEL));

                // Only update if values exist in settings
                if (leftVisible !== undefined) setLeftSidebarVisible(Boolean(leftVisible && leftPanel !== null));
                if (rightVisible !== undefined) setRightSidebarVisible(Boolean(rightVisible && rightPanel !== null));
                if (bottomVisible !== undefined) setBottomPanelVisible(Boolean(bottomVisible && bottomPanel !== null));
                if (leftWidth !== undefined) {
                    setLeftSidebarWidth(leftWidth);
                    leftSidebarWidthRef.current = leftWidth;
                }
                if (rightWidth !== undefined) {
                    setRightSidebarWidth(rightWidth);
                    rightSidebarWidthRef.current = rightWidth;
                }
                if (bottomHeight !== undefined) {
                    setBottomPanelHeight(bottomHeight);
                    bottomPanelHeightRef.current = bottomHeight;
                }
                // Defaults to closed. An author who has not asked for version control gets no column
                // at all - not even the 48px strip, which exists only while the workspace is frozen.
                const railExpanded = await settingsService.get<boolean>(SETTINGS_KEYS.VERSION_RAIL_EXPANDED);
                setVersionRailExpanded(railExpanded === true);
                if (leftPanel !== undefined) setActiveLeftPanelId(leftPanel);
                if (rightPanel !== undefined) setActiveRightPanelId(rightPanel);
                if (bottomPanel !== undefined) setActiveBottomPanelId(bottomPanel);

                // Load persisted panel ordering and apply it to the UIStore (source of truth).
                const store = context?.services.get<UIService>(Services.UI).getStore();
                const loadedOrders: Partial<Record<PanelPosition, string[]>> = {};
                for (const position of [PanelPosition.Left, PanelPosition.Right, PanelPosition.Bottom]) {
                    const savedOrder = await settingsService.get<string[]>(ORDER_SETTINGS_KEY_BY_POSITION[position]);
                    if (Array.isArray(savedOrder) && savedOrder.length > 0) {
                        loadedOrders[position] = savedOrder;
                        store?.setPanelOrder(position, savedOrder);
                    }
                }
                setPanelOrders(loadedOrders);

                // The defaults apply only when nothing was ever stored, so a group the user has
                // emptied stays empty instead of springing back on the next launch.
                const savedCollapsed = await settingsService.get<string[]>(SETTINGS_KEYS.LEFT_SIDEBAR_COLLAPSED);
                const collapsed = Array.isArray(savedCollapsed)
                    ? savedCollapsed
                    : [...DEFAULT_COLLAPSED_PANEL_IDS];
                store?.setCollapsedPanels(PanelPosition.Left, collapsed);
                setCollapsedLeftPanels(collapsed);

                setSettingsLoaded(true);
                console.log("[WorkspaceLayout] Settings loaded successfully");
            } catch (error) {
                console.error("Failed to load workspace layout settings:", error);
                setSettingsLoaded(true); // Mark as loaded even on error to allow saving
            }
        };

        loadSettings();
    }, [settingsService, context]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    // Track the live viewport so the derived effective sizes reflow with the window. Unlike the
    // old clamp-on-resize logic, this never mutates the intended sizes — a panel clamped down on a
    // small window grows back toward its intent when space returns.
    useEffect(() => {
        const handleWindowResize = () => {
            setViewport({ width: window.innerWidth, height: window.innerHeight - statusBarHeight });
        };
        handleWindowResize();
        window.addEventListener("resize", handleWindowResize);
        return () => {
            window.removeEventListener("resize", handleWindowResize);
        };
    }, [statusBarHeight]);

    // Save state when it changes (but only after initial load)
    useEffect(() => {
        if (!settingsService || !settingsLoaded) return;

        // Trigger debounced save
        debouncedSaveSettings();
    }, [
        settingsService,
        settingsLoaded,
        debouncedSaveSettings,
    ]);

    // Whether the version rail is a column at all, and which one. `absent` is the ordinary answer -
    // the strip exists only while project data is frozen, because what it expresses is control over
    // that temporary state; the panel is openable at any time from the status cell or the switcher menu.
    const railPresence = resolveVersionRailPresence({
        state: versionSurface.state,
        expanded: versionRailExpanded,
        frozen: versionSurface.frozen !== null,
    });
    // What that takes out of the horizontal chain: 0 absent, 48 strip, 320 panel.
    const railWidth = versionRailWidth(railPresence);
    versionRailWidthRef.current = railWidth;

    // Live environment for the sizing solver, rebuilt from the current viewport + visibility.
    const dockEnv: DockEnv = {
        windowWidth: viewport.width,
        windowHeight: viewport.height,
        leftVisible: leftSidebarVisible,
        rightVisible: rightSidebarVisible,
        versionRailWidth: railWidth,
    };

    // Effective (rendered) sizes derived from the intended sizes. Sidebars are protected from
    // eating the editor floor (clamp); the bottom panel may cover it (clip).
    const effective = resolveDock(
        { left: leftSidebarWidth, right: rightSidebarWidth, bottom: bottomPanelHeight },
        dockEnv,
    );

    // Resize handlers. Refs give synchronous reads during fast drags; applyResize enforces the
    // region constraints and returns the position correction ResizableHandle expects.
    const currentEnv = useCallback(
        (): DockEnv => ({
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            leftVisible: leftSidebarVisibleRef.current,
            rightVisible: rightSidebarVisibleRef.current,
            versionRailWidth: versionRailWidthRef.current,
        }),
        []
    );

    const handleLeftSidebarResize = useCallback((delta: number) => {
        const { next, correction } = applyResize(
            "left", leftSidebarWidthRef.current, delta, currentEnv(), rightSidebarWidthRef.current
        );
        leftSidebarWidthRef.current = next;
        setLeftSidebarWidth(next);
        return correction;
    }, [currentEnv]);

    const handleRightSidebarResize = useCallback((delta: number) => {
        const { next, correction } = applyResize(
            "right", rightSidebarWidthRef.current, delta, currentEnv(), leftSidebarWidthRef.current
        );
        rightSidebarWidthRef.current = next;
        setRightSidebarWidth(next);
        return correction;
    }, [currentEnv]);

    const handleBottomPanelResize = useCallback((delta: number) => {
        const { next, correction } = applyResize(
            "bottom", bottomPanelHeightRef.current, delta, currentEnv(), 0
        );
        bottomPanelHeightRef.current = next;
        setBottomPanelHeight(next);
        return correction;
    }, [currentEnv]);

    // The first panel that would actually show in a dock's rail: not hidden, not folded into the
    // collapse group, and not a (bodyless) rail action — so opening a sidebar with no active panel
    // never lands on a hidden, folded-away or empty one.
    const firstVisiblePanelId = (position: PanelPosition): string | null => {
        const store = context?.services.get<UIService>(Services.UI).getStore();
        const visibility = store?.getPanelVisibility() ?? {};
        const collapsed = store?.getCollapsedPanels()[position] ?? [];
        const first = getPanelsByPosition(position).find(
            panel => !panel.railAction && visibility[panel.id] !== false && !collapsed.includes(panel.id),
        );
        return first?.id ?? null;
    };

    // Enhanced toggle functions that auto-select first panel if none is active
    const toggleLeftSidebar = () => {
        if (!leftSidebarVisible && !activeLeftPanelId) {
            const firstId = firstVisiblePanelId(PanelPosition.Left);
            if (firstId) {
                setActiveLeftPanelId(firstId);
            }
        }
        setLeftSidebarVisible(!leftSidebarVisible);
    };

    const toggleRightSidebar = () => {
        if (!rightSidebarVisible && !activeRightPanelId) {
            const firstId = firstVisiblePanelId(PanelPosition.Right);
            if (firstId) {
                setActiveRightPanelId(firstId);
            }
        }
        setRightSidebarVisible(!rightSidebarVisible);
    };

    const toggleBottomPanel = () => {
        if (!bottomPanelVisible && !activeBottomPanelId) {
            const firstId = firstVisiblePanelId(PanelPosition.Bottom);
            if (firstId) {
                setActiveBottomPanelId(firstId);
            }
        }
        setBottomPanelVisible(!bottomPanelVisible);
    };

    // The toggles close over render-scoped state, so the menu calls them through refs rather
    // than re-registering the group on every render.
    const panelTogglesRef = useRef({ toggleLeftSidebar, toggleBottomPanel, toggleRightSidebar });
    panelTogglesRef.current = { toggleLeftSidebar, toggleBottomPanel, toggleRightSidebar };

    // One command table for the dock toggles, consumed by every surface: the CommandService (so
    // the palette reaches them on every platform) and — on macOS only — the Window menu group,
    // generated from the same definitions. ControlBar buttons stay the pointer-first entry point.
    useEffect(() => {
        const toggleDefs = [
            {
                id: WorkspaceMenuAction.ToggleLeftSidebar,
                labelKey: "menu.window.leftSidebar" as const,
                // The same three glyphs the ControlBar buttons wear, so the palette row and the
                // button that does the same thing are recognisably one control.
                icon: <PanelLeft className="w-4 h-4" />,
                checked: leftSidebarVisible,
                run: () => panelTogglesRef.current.toggleLeftSidebar(),
            },
            {
                id: WorkspaceMenuAction.ToggleBottomPanel,
                labelKey: "menu.window.bottomPanel" as const,
                icon: <PanelBottom className="w-4 h-4" />,
                checked: bottomPanelVisible,
                run: () => panelTogglesRef.current.toggleBottomPanel(),
            },
            {
                id: WorkspaceMenuAction.ToggleRightSidebar,
                labelKey: "menu.window.rightSidebar" as const,
                icon: <PanelRight className="w-4 h-4" />,
                checked: rightSidebarVisible,
                run: () => panelTogglesRef.current.toggleRightSidebar(),
            },
        ];

        const commandService = context?.services.get<CommandService>(Services.Command);
        const disposeCommands = commandService?.registerMany(
            toggleDefs.map(def => ({
                id: def.id,
                titleKey: def.labelKey,
                categoryKey: "workspace.shell.commandPalette.categoryView" as const,
                icon: def.icon,
                run: () => def.run(),
            })),
        );

        // The in-app dropdown would only duplicate the ControlBar buttons, so the group goes to
        // the native menu bar alone — which exists on macOS only.
        if (isMacPlatform()) {
            registerActionGroup({
                id: PANEL_TOGGLES_GROUP_ID,
                label: t("menu.window.title"),
                menuSlot: "window",
                items: toggleDefs.map((def, order) => ({
                    id: def.id,
                    label: t(def.labelKey),
                    // Carried through even though the native menu bar cannot draw it: these ids also
                    // exist as registered commands above, and if that pass ever stops claiming them
                    // first the palette falls back to this copy - which would then be the blank one.
                    icon: def.icon,
                    checked: def.checked,
                    onClick: def.run,
                    order,
                })),
            });
        }

        return () => {
            disposeCommands?.();
            if (isMacPlatform()) {
                unregisterActionGroup(PANEL_TOGGLES_GROUP_ID);
            }
        };
    }, [t, context, leftSidebarVisible, bottomPanelVisible, rightSidebarVisible, registerActionGroup, unregisterActionGroup]);

    const activateLeftPanelForDrop = useCallback(
        (panelId: string) => {
            setActiveLeftPanelId(panelId);
            setLeftSidebarVisible(true);
            if (context) {
                const uiService = context.services.get<UIService>(Services.UI);
                uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
            }
        },
        [context]
    );

    const activateRightPanelForDrop = useCallback(
        (panelId: string) => {
            setActiveRightPanelId(panelId);
            setRightSidebarVisible(true);
            if (context) {
                const uiService = context.services.get<UIService>(Services.UI);
                uiService.focus.setFocus(FocusArea.RightPanel, panelId);
            }
        },
        [context]
    );

    const activateBottomPanelForDrop = useCallback(
        (panelId: string) => {
            setActiveBottomPanelId(panelId);
            setBottomPanelVisible(true);
            if (context) {
                const uiService = context.services.get<UIService>(Services.UI);
                uiService.focus.setFocus(FocusArea.BottomPanel, panelId);
            }
        },
        [context]
    );

    useEffect(() => {
        if (!context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();

        const panelsByPosition = (position: PanelPosition) => {
            return store.getPanels().filter(panel => panel.position === position);
        };

        const showPanel = (panel: PanelDefinition) => {
            // A rail action has no body — restoring its visibility just brings the rail icon back;
            // it must not become the active panel or open the sidebar onto nothing.
            if (panel.railAction) {
                return;
            }
            if (panel.position === PanelPosition.Left) {
                setActiveLeftPanelId(panel.id);
                setLeftSidebarVisible(true);
            } else if (panel.position === PanelPosition.Right) {
                setActiveRightPanelId(panel.id);
                setRightSidebarVisible(true);
            } else {
                setActiveBottomPanelId(panel.id);
                setBottomPanelVisible(true);
            }
        };

        const hidePanel = (panel: PanelDefinition) => {
            // Pick a replacement among the panels that are still visible (rail actions excluded —
            // they have no body). Prefer the nearest one before the hidden panel, else the one after.
            const visibility = store.getPanelVisibility();
            const panels = panelsByPosition(panel.position);
            const isReplacement = (candidate: PanelDefinition) =>
                candidate.id !== panel.id && !candidate.railAction && visibility[candidate.id] !== false;
            const targetIndex = panels.findIndex(entry => entry.id === panel.id);
            const before = panels.slice(0, Math.max(targetIndex, 0)).filter(isReplacement).at(-1);
            const after = panels.slice(targetIndex + 1).find(isReplacement);
            const fallbackId = (before ?? after)?.id ?? null;
            if (panel.position === PanelPosition.Left && activeLeftPanelIdRef.current === panel.id) {
                setActiveLeftPanelId(fallbackId);
                setLeftSidebarVisible(Boolean(fallbackId));
            } else if (panel.position === PanelPosition.Right && activeRightPanelIdRef.current === panel.id) {
                setActiveRightPanelId(fallbackId);
                setRightSidebarVisible(Boolean(fallbackId));
            } else if (panel.position === PanelPosition.Bottom && activeBottomPanelIdRef.current === panel.id) {
                setActiveBottomPanelId(fallbackId);
                setBottomPanelVisible(Boolean(fallbackId));
            }
        };

        const handlePanelVisibilityChanged = ({ panelId, visible }: { panelId: string; visible: boolean }) => {
            const panel = store.getPanels().find(item => item.id === panelId);
            if (!panel) {
                return;
            }
            visible ? showPanel(panel) : hidePanel(panel);
        };

        const handlePanelUnregistered = (panelId: string) => {
            if (activeLeftPanelIdRef.current === panelId) {
                const fallbackId = panelsByPosition(PanelPosition.Left).at(-1)?.id ?? null;
                setActiveLeftPanelId(fallbackId);
                setLeftSidebarVisible(Boolean(fallbackId));
            }
            if (activeRightPanelIdRef.current === panelId) {
                const fallbackId = panelsByPosition(PanelPosition.Right).at(-1)?.id ?? null;
                setActiveRightPanelId(fallbackId);
                setRightSidebarVisible(Boolean(fallbackId));
            }
            if (activeBottomPanelIdRef.current === panelId) {
                const fallbackId = panelsByPosition(PanelPosition.Bottom).at(-1)?.id ?? null;
                setActiveBottomPanelId(fallbackId);
                setBottomPanelVisible(Boolean(fallbackId));
            }
        };

        const handlePanelOrderChanged = ({ position, order }: { position: string; order: string[] }) => {
            setPanelOrders(prev => ({ ...prev, [position as PanelPosition]: order }));
        };

        const handleCollapsedPanelsChanged = ({ position, collapsed }: { position: string; collapsed: string[] }) => {
            if (position === PanelPosition.Left) {
                setCollapsedLeftPanels(collapsed);
            }
        };

        const unsubscribeVisibility = uiService.getEvents().on("panelVisibilityChanged", handlePanelVisibilityChanged);
        const unsubscribeUnregistered = uiService.getEvents().on("panelUnregistered", handlePanelUnregistered);
        const unsubscribeOrder = uiService.getEvents().on("panelOrderChanged", handlePanelOrderChanged);
        const unsubscribeCollapsed = uiService.getEvents().on("collapsedPanelsChanged", handleCollapsedPanelsChanged);
        return () => {
            unsubscribeVisibility();
            unsubscribeUnregistered();
            unsubscribeOrder();
            unsubscribeCollapsed();
        };
    }, [context]);

    const isMac = isMacPlatform();

    // Custom workspace background. Rendered as ONE pre-composited backdrop behind all chrome: the
    // surface colour with the wallpaper already blended in at its configured strength (the 2–40%
    // "opacity" the dialog exposes). When it is active, `nl-has-workspace-bg` makes every base
    // `bg-surface` fill fully TRANSPARENT (see styles.css), so the panels AND the seams between them
    // reveal this single layer uniformly. Because no element ever paints the raw picture, there is
    // no bright bleed through the gaps; and text, icons, borders, raised/overlay surfaces and content
    // images all keep their own opaque paints, so real content never reads as see-through.
    const { settings: backgroundSettings, url: backgroundUrl } = useWorkspaceBackgroundImage();

    return (
        <div
            {...windowRootProps}
            className={`relative isolate h-screen w-screen flex flex-col bg-surface text-fg${backgroundUrl ? " nl-has-workspace-bg" : ""}`}
        >
            <TooltipHost />
            {backgroundUrl && (
                <div
                    aria-hidden
                    className="pointer-events-none fixed inset-0 overflow-hidden"
                    style={{ zIndex: -1, backgroundColor: "rgb(var(--nl-surface))" }}
                >
                    <div className="absolute" style={backgroundLayerStyle(backgroundSettings, backgroundUrl)} />
                </div>
            )}
            {/* Title Bar with Action Bar and Control Bar */}
            <TitleBar
                title=""
                iconSrc={iconSrc}
                center={titleBarSearchVisible ? <TitleBarSearchBox /> : undefined}
                actionBar={
                    <div className="flex items-center gap-0.5">
                        {/* The window's identity, and the version control menu inside it — one reader
                            for both, handed down. The rail below gets the SAME object: a second
                            `useVersionSurface()` would be a second answer to "which version is this",
                            and that has already been on screen once (rail `#3`, status cell `#2`). */}
                        <ProjectSwitcher versionSurface={versionSurface} />
                        <ActionBar hideAllGroups={isMac} />
                    </div>
                }
                controlBar={
                    <ControlBar
                        leftSidebarVisible={leftSidebarVisible}
                        rightSidebarVisible={rightSidebarVisible}
                        bottomPanelVisible={bottomPanelVisible}
                        onToggleLeftSidebar={toggleLeftSidebar}
                        onToggleRightSidebar={toggleRightSidebar}
                        onToggleBottomPanel={toggleBottomPanel}
                    />
                }
            />

            <RecoveryBanner />

            <ExperimentalNotice />

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Version rail — the far left of the window, LEFT of the sidebar selector, because in
                    a past version the author still needs the sidebar, the assets and the scene tree.
                    Its width is in the dock account above (dockEnv.versionRailWidth), never outside it. */}
                <VersionRail
                    surface={versionSurface}
                    presence={railPresence}
                    onExpandedChange={setVersionRailExpanded}
                />

                {/* Left Sidebar Selector */}
                <LeftSidebarSelector
                    visible={leftSidebarVisible}
                    activeId={activeLeftPanelId}
                    onToggleVisibility={() => setLeftSidebarVisible(!leftSidebarVisible)}
                    onSelectPanel={setActiveLeftPanelId}
                />

                {/* Left Sidebar - Always rendered, controlled by CSS visibility */}
                <div 
                    className={leftSidebarVisible && activeLeftPanelId ? "flex" : "hidden"}
                >
                    <LeftSidebar
                        panelId={activeLeftPanelId || ""}
                        onClose={() => setLeftSidebarVisible(false)}
                        width={effective.left}
                    />
                    <ResizableHandle direction="horizontal" onResize={handleLeftSidebarResize} />
                </div>

                {/* Center Area (min-w-0/min-h-0 so it can shrink below content in the flex chain) */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                    {/* Main Editor Area — its layout box may shrink to any size (even 0 when the
                        bottom panel covers it), but the editor CONTENT is floored at EDITOR_FLOOR
                        and cropped by overflow-hidden, so it is never rendered at a deformed size. */}
                    <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
                        <div
                            className="w-full h-full overflow-hidden"
                            style={{ minWidth: EDITOR_FLOOR.width, minHeight: EDITOR_FLOOR.height }}
                        >
                            <MainEditorArea />
                        </div>
                    </div>

                    {/* Bottom Panel - Always rendered, controlled by CSS visibility. shrink-0 keeps
                        its height so the editor above yields space instead of the panel collapsing. */}
                    <div
                        className={bottomPanelVisible && activeBottomPanelId ? "shrink-0" : "hidden"}
                        style={{ height: bottomPanelVisible && activeBottomPanelId ? `${effective.bottom}px` : 0 }}
                    >
                        <ResizableHandle direction="vertical" onResize={handleBottomPanelResize} />
                        <BottomPanel
                            panelId={activeBottomPanelId || ""}
                            onClose={() => setBottomPanelVisible(false)}
                            height={effective.bottom}
                        />
                    </div>
                </div>

                {/* Right Sidebar - Always rendered, controlled by CSS visibility */}
                <div 
                    className={rightSidebarVisible && activeRightPanelId ? "flex" : "hidden"}
                >
                    <ResizableHandle direction="horizontal" onResize={handleRightSidebarResize} />
                    <RightSidebar
                        panelId={activeRightPanelId || ""}
                        onClose={() => setRightSidebarVisible(false)}
                        width={effective.right}
                    />
                </div>

                {/* Right Sidebar Selector */}
                <RightSidebarSelector
                    visible={rightSidebarVisible}
                    activeId={activeRightPanelId}
                    onToggleVisibility={() => setRightSidebarVisible(!rightSidebarVisible)}
                    onSelectPanel={setActiveRightPanelId}
                />
            </div>

            {/* Status Bar */}
            {statusBarVisible && <StatusBar />}

            {/* Bottom Panel Selector — in the SELECTOR rail's column, just above the status bar, so its
                triggers line up with the left dock's. Absolutely positioned, so unlike every column in
                the flex row above it has to be told where that column starts: `left-0` was right until
                the version rail appeared to the left of the selector rail, and then the bottom triggers
                sat in the version rail's column while the left dock's stayed one column over (measured
                in the running app at x≈29 against x≈90). One column holds both docks' items; the
                version rail is a column of its own and does not adopt them. */}
            <div className="absolute" style={{ bottom: statusBarHeight, left: railColumnOffsets(dockEnv).sidebarRail }}>
                <BottomPanelSelector
                    visible={bottomPanelVisible}
                    activeId={activeBottomPanelId}
                    onToggleVisibility={() => setBottomPanelVisible(!bottomPanelVisible)}
                    onSelectPanel={setActiveBottomPanelId}
                    onActivatePanelForDrop={activateBottomPanelForDrop}
                />
            </div>

            {/* UI Overlays */}
            <BackgroundImageDialog />
            <WorkspaceEditorQuickSwitch />
            {/* The palette and quick-open are absent in a recovery window, and not merely as
                tidiness: both walk the story library, the cast and the interface documents to build
                their entries, and in this mode those are exactly the services that may never have
                started. `WorkspaceCommands` goes with them because half of what it registers writes
                to a project this window is holding read-only. */}
            {!recovery && (
                <>
                    <CommandPalette />
                    <QuickOpenPicker />
                    <WorkspaceCommands />
                </>
            )}
            <EditorCommands />
            <WorkspaceFreezeCommands />
            <LintCommands />
            <StoryScriptCommands />
            <NarralangCommands />
            <KeybindingCheatSheet />
            {/* Present in a recovery window too: that is the one place an author most needs to be
                told what is going on, and help reads nothing from the project. */}
            <WorkspaceHelp />
            <EditorClosedTabsKeybinding />
            <WorkspaceUndoKeybindings />
            <WorkspaceHistoryMenu />
            <NotificationContainer />
            <DialogContainer />
        </div>
    );
}
