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
import { MainMenuButton } from "./MainMenuButton";
import { useMenuBarModeContextMenu } from "./useMenuBarModeContextMenu";
import { MENU_BAR_MODE_DEFAULT, MENU_BAR_MODE_KEY, MenuBarMode, resolveMenuBarMode } from "@/lib/settings/menuBarOptions";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ControlBar } from "./ControlBar";
import { LiveSessionPresence, TeamProjectProvider } from "../../modules/team";
import { NotificationContainer } from "../ui/NotificationContainer";
import { DialogContainer } from "../ui/DialogContainer";
import { ResizableHandle } from "../ui/ResizableHandle";
import { TitleBarMenus } from "../ui/titleBarMenus";
import { HostVisibility } from "@/lib/components/layout";
import { EditorClosedTabsKeybinding } from "./EditorClosedTabsKeybinding";
import { WorkspaceUndoKeybindings } from "./WorkspaceUndoKeybindings";
import { WorkspaceHistoryMenu } from "./WorkspaceHistoryMenu";
import { WorkspaceEditorQuickSwitch } from "./WorkspaceEditorQuickSwitch";
import { CommandPalette } from "./CommandPalette";
import { EditorCommands } from "./EditorCommands";
import { WorkspaceFreezeCommands } from "./WorkspaceFreezeCommands";
import { LiveSessionFreezeCommands } from "./LiveSessionFreezeCommands";
import { LintCommands } from "../../modules/lint/LintCommands";
import { StoryScriptCommands } from "../../modules/story/script/StoryScriptCommands";
import { NarralangCommands } from "../../modules/story/narralang/NarralangCommands";
import { narralangUiEnabled } from "../../modules/story/narralang/narralangUi";
import { WorkspaceCommands } from "./WorkspaceCommands";
import { KeybindingCheatSheet } from "./KeybindingCheatSheet";
import { WorkspaceHelp } from "./WorkspaceHelp";
import { TitleBarSearchBox } from "./TitleBarSearchBox";
import { StatusBar, STATUS_BAR_HEIGHT } from "./StatusBar";
import { QuickOpenPicker } from "./QuickOpenPicker";
import { BackgroundImageDialog } from "./BackgroundImageDialog";
import { useWorkspaceBackgroundImage } from "./useWorkspaceBackgroundImage";
import { backgroundLayerStyle } from "@/lib/workspace/services/ui/backgroundSettings";
import { useKeybindings } from "../../hooks";
import { useRegistry } from "../../registry";
import { useDialogs } from "../../hooks/useUIService";
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
    RAIL_SELECTOR_WIDTH,
    applyResize,
    railColumnOffsets,
    resolveDock,
    type DockEnv,
} from "./dockLayoutModel";
import { DEFAULT_COLLAPSED_PANEL_IDS } from "./sidebarPanelGroup";
import { firstDrawablePanelId, resolveActivePanelId, type DockPanelAvailability } from "./dockActivePanel";
import { VersionRail } from "./VersionRail";
import { resolveVersionRailPresence, versionRailWidth } from "./versionRailModel";
import { useVersionSurface } from "../../hooks/useVersionSurface";

interface WorkspaceLayoutProps {
    title: string;
    /** See `TitleBarProps.iconSrc`: omit for the product mark, `""` for none. */
    iconSrc?: string;
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

/**
 * Panels that no build of Studio has any more, whose stored selection is cleared on load.
 *
 * Distinct from an id that merely names nothing in THIS window - a plugin that is not installed
 * here, or has not finished loading yet - which `resolveActivePanelId` answers at render without
 * writing anything (see `dockActivePanel`). These ids are dead in every window, for every project
 * and for good, so clearing them from an app-wide store loses nobody anything.
 */
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
    const {
        getPanelsByPosition,
        // The rail state each dock's shown panel is resolved against, read reactively so a panel
        // registering (a plugin finishing its load) re-renders the docks that were waiting for it.
        visiblePanels,
        collapsedPanels: collapsedPanelIds,
        registerActionGroup,
        unregisterActionGroup,
    } = useRegistry();
    const { context, recovery } = useWorkspace();
    // Only whether one is up, for the title bar's menus; `DialogContainer` is what draws them.
    const dialogs = useDialogs();
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
    // Where the registered menus are drawn: named along the bar, or collapsed into one hamburger.
    const [menuBarMode, setMenuBarMode] = useState<MenuBarMode>(MENU_BAR_MODE_DEFAULT);
    useEffect(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        setStatusBarVisible(settings.getSync("ui.statusBar.visible") !== false);
        setTitleBarSearchVisible(settings.getSync("ui.titleBarSearch.visible") !== false);
        setMenuBarMode(resolveMenuBarMode(settings.getSync(MENU_BAR_MODE_KEY)));
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === "ui.statusBar.visible") {
                setStatusBarVisible(change.value !== false);
            }
            if (change.key === "ui.titleBarSearch.visible") {
                setTitleBarSearchVisible(change.value !== false);
            }
            if (change.key === MENU_BAR_MODE_KEY) {
                setMenuBarMode(resolveMenuBarMode(change.value));
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
     * The restored layout is about a project this window is not showing, and in this mode the panel
     * it names is usually not registered at all - a case `resolveActivePanelId` already answers, by
     * showing whatever this window does have. What that cannot know is which panel is worth
     * reading: it is the recovery panel, and left to the general rule it would sit behind an icon
     * nobody has a reason to click. So this names it, once settings have loaded so it wins over
     * them, and writes nothing back.
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

    // The sidebar visibility mirrors are written where the dock's rendered openness is worked out
    // (below), not from this state: a sidebar asked for but with no panel to put in it takes no
    // width, and a drag bounded as though it did would let the other one over the editor's floor.

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

    /**
     * What each dock actually shows, resolved against the panels this window has registered.
     *
     * The stored selection outlives the panel it names: it is kept in an app-wide store, while the
     * panel set is whatever this window happens to have registered - so a plugin that is not
     * installed here, or has not finished loading yet, leaves an id behind that nothing can draw.
     * `dockActivePanel` decides what to show for it and writes nothing back; see there for why the
     * repair must stay out of the store.
     *
     * Everything below reads these rather than the stored ids: the rail (so the icon that is lit is
     * the panel on screen), the cells (so one is never drawn around nothing), the toggles, and the
     * sizing solver - a dock that draws nothing must not reserve a column either.
     */
    const availability = (position: PanelPosition): DockPanelAvailability => ({
        visibility: visiblePanels,
        collapsed: collapsedPanelIds[position],
    });
    const shownLeftPanelId = resolveActivePanelId(
        activeLeftPanelId, getPanelsByPosition(PanelPosition.Left), availability(PanelPosition.Left));
    const shownRightPanelId = resolveActivePanelId(
        activeRightPanelId, getPanelsByPosition(PanelPosition.Right), availability(PanelPosition.Right));
    const shownBottomPanelId = resolveActivePanelId(
        activeBottomPanelId, getPanelsByPosition(PanelPosition.Bottom), availability(PanelPosition.Bottom));
    // Whether each dock is a region on screen at all: asked for AND with a panel to put in it.
    const leftDockOpen = leftSidebarVisible && shownLeftPanelId !== null;
    const rightDockOpen = rightSidebarVisible && shownRightPanelId !== null;
    const bottomDockOpen = bottomPanelVisible && shownBottomPanelId !== null;
    // Mirrored for the resize handlers, which read them synchronously mid-drag.
    leftSidebarVisibleRef.current = leftDockOpen;
    rightSidebarVisibleRef.current = rightDockOpen;

    // Live environment for the sizing solver, rebuilt from the current viewport + visibility.
    const dockEnv: DockEnv = {
        windowWidth: viewport.width,
        windowHeight: viewport.height,
        leftVisible: leftDockOpen,
        rightVisible: rightDockOpen,
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
    // never lands on a hidden, folded-away or empty one. The same rule `dockActivePanel` falls back
    // to, from the same module, so the panel a dock opens onto and the one it recovers to agree.
    const firstVisiblePanelId = (position: PanelPosition): string | null =>
        firstDrawablePanelId(getPanelsByPosition(position), availability(position));

    // Enhanced toggle functions that auto-select first panel if none is active. They turn on what
    // the author can see — a dock asked for but drawing nothing is closed as far as they are
    // concerned, and the press that ought to open it must not spend itself closing it instead.
    const toggleLeftSidebar = () => {
        if (!leftDockOpen && !shownLeftPanelId) {
            const firstId = firstVisiblePanelId(PanelPosition.Left);
            if (firstId) {
                setActiveLeftPanelId(firstId);
            }
        }
        setLeftSidebarVisible(!leftDockOpen);
    };

    const toggleRightSidebar = () => {
        if (!rightDockOpen && !shownRightPanelId) {
            const firstId = firstVisiblePanelId(PanelPosition.Right);
            if (firstId) {
                setActiveRightPanelId(firstId);
            }
        }
        setRightSidebarVisible(!rightDockOpen);
    };

    const toggleBottomPanel = () => {
        if (!bottomDockOpen && !shownBottomPanelId) {
            const firstId = firstVisiblePanelId(PanelPosition.Bottom);
            if (firstId) {
                setActiveBottomPanelId(firstId);
            }
        }
        setBottomPanelVisible(!bottomDockOpen);
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
                checked: leftDockOpen,
                run: () => panelTogglesRef.current.toggleLeftSidebar(),
            },
            {
                id: WorkspaceMenuAction.ToggleBottomPanel,
                labelKey: "menu.window.bottomPanel" as const,
                icon: <PanelBottom className="w-4 h-4" />,
                checked: bottomDockOpen,
                run: () => panelTogglesRef.current.toggleBottomPanel(),
            },
            {
                id: WorkspaceMenuAction.ToggleRightSidebar,
                labelKey: "menu.window.rightSidebar" as const,
                icon: <PanelRight className="w-4 h-4" />,
                checked: rightDockOpen,
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
    }, [t, context, leftDockOpen, bottomDockOpen, rightDockOpen, registerActionGroup, unregisterActionGroup]);

    /**
     * The dock toggles, by key.
     *
     * Registered from the same refs the commands above run through, so the keystroke and the palette
     * row cannot drift apart. `catalogPrefix` composes each id below into the command id it runs
     * (`narraleaf-studio:toggle-left-sidebar` and friends), which is what keeps the palette to one
     * row per toggle showing its chord rather than listing the shortcut again under a second name.
     *
     * `allowInEditable`, unlike most workspace shortcuts: none of these three chords types anything,
     * and an author whose caret is in a story line is exactly who wants the bottom panel out of the
     * way without first clicking somewhere neutral.
     */
    useKeybindings({
        keybindings: [
            {
                id: "left-sidebar",
                key: "mod+shift+b",
                description: "Show or hide the left sidebar",
                allowInEditable: true,
                handler: () => panelTogglesRef.current.toggleLeftSidebar(),
            },
            {
                id: "bottom-panel",
                key: "mod+j",
                description: "Show or hide the bottom panel",
                allowInEditable: true,
                handler: () => panelTogglesRef.current.toggleBottomPanel(),
            },
            {
                id: "right-sidebar",
                key: "mod+alt+r",
                description: "Show or hide the right sidebar",
                allowInEditable: true,
                handler: () => panelTogglesRef.current.toggleRightSidebar(),
            },
        ],
        idPrefix: "workspace-dock",
        catalogPrefix: "narraleaf-studio:toggle-",
    });

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
            setPanelOrders(prev => {
                // An empty order is the store saying the override was dropped; forgetting the key
                // makes the setting persist as "nothing stored", which is what the loader treats as
                // the default order.
                if (order.length === 0) {
                    const { [position as PanelPosition]: _dropped, ...rest } = prev;
                    return rest;
                }
                return { ...prev, [position as PanelPosition]: order };
            });
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
    // macOS keeps these menus on the system menu bar (`useNativeMenuSync`), so there is nothing in
    // the title bar for the mode to move and nothing to offer on its right-click menu.
    const menusInHamburger = !isMac && menuBarMode === "hamburger";
    const menuBarModeMenu = useMenuBarModeContextMenu(menuBarMode);

    // Custom workspace background. Rendered as ONE pre-composited backdrop behind all chrome: the
    // surface colour with the wallpaper already blended in at its configured strength (the 2–40%
    // "opacity" the dialog exposes). When it is active, `nl-has-workspace-bg` makes every base
    // `bg-surface` fill fully TRANSPARENT (see styles.css), so the panels AND the seams between them
    // reveal this single layer uniformly. Because no element ever paints the raw picture, there is
    // no bright bleed through the gaps; and text, icons, borders, raised/overlay surfaces and content
    // images all keep their own opaque paints, so real content never reads as see-through.
    const { settings: backgroundSettings, url: backgroundUrl } = useWorkspaceBackgroundImage();

    return (
        <TeamProjectProvider surface={versionSurface}>
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
                        /* One bar, so only one of its menus is ever on screen, the pointer and the
                           arrow keys walk between the action groups, and Alt reaches them directly.
                           Its keyboard stands down while a dialog is up, which is the same gate
                           `KeybindingService` puts on its own bindings.

                           It is still one bar when the menus are collapsed: the hamburger is a member
                           like any other, and it declares the accelerators of the groups it swallowed,
                           so Alt+F reaches the File menu in either arrangement.

                           Right-clicking the cluster offers where the main menu goes — the gesture is
                           on the strip the setting moves, which is the only way back for an author who
                           has just collapsed their File menu into the hamburger. */
                        <TitleBarMenus
                            className="flex items-center gap-0.5"
                            suspended={dialogs.length > 0}
                            onContextMenu={isMac ? undefined : menuBarModeMenu.openMenu}
                        >
                            {/* Every registered menu, collapsed into one button at the far left, where a
                                window's own menu belongs. The bar's dropdowns are dropped in that mode
                                rather than doubled (`hideAllGroups`). */}
                            {menusInHamburger && <MainMenuButton />}
                            {/* The window's identity, and the version control menu inside it — one reader
                                for both, handed down. The rail below gets the SAME object: a second
                                `useVersionSurface()` would be a second answer to "which version is this",
                                and that has already been on screen once (rail `#3`, status cell `#2`). */}
                            <ProjectSwitcher versionSurface={versionSurface} />
                            <ActionBar hideAllGroups={isMac || menusInHamburger} />
                            {!isMac && menuBarModeMenu.menu}
                        </TitleBarMenus>
                    }
                    controlBar={
                        <>
                            {/* Who is in this project with you, left of the window's own controls -
                                where an application puts the people you are in a document with. It is
                                the only always-visible statement that a live session is running, and a
                                session outlives every tab. */}
                            <LiveSessionPresence />
                            <ControlBar
                                leftSidebarVisible={leftDockOpen}
                                rightSidebarVisible={rightDockOpen}
                                bottomPanelVisible={bottomDockOpen}
                                onToggleLeftSidebar={toggleLeftSidebar}
                                onToggleRightSidebar={toggleRightSidebar}
                                onToggleBottomPanel={toggleBottomPanel}
                            />
                        </>
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
                        visible={leftDockOpen}
                        activeId={shownLeftPanelId}
                        onToggleVisibility={() => setLeftSidebarVisible(!leftDockOpen)}
                        onSelectPanel={setActiveLeftPanelId}
                    />

                    {/* Left Sidebar - Always rendered, controlled by CSS visibility. Collapsing it
                        hides the panel without unmounting it, so anything the panel portalled to the
                        body would stay on screen; `HostVisibility` is what tells those layers. */}
                    <div 
                        className={leftDockOpen ? "flex" : "hidden"}
                    >
                        <HostVisibility visible={leftDockOpen}>
                            <LeftSidebar
                                panelId={shownLeftPanelId || ""}
                                onClose={() => setLeftSidebarVisible(false)}
                                width={effective.left}
                            />
                        </HostVisibility>
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
                            className={bottomDockOpen ? "shrink-0" : "hidden"}
                            style={{ height: bottomDockOpen ? `${effective.bottom}px` : 0 }}
                        >
                            <ResizableHandle direction="vertical" onResize={handleBottomPanelResize} />
                            <HostVisibility visible={bottomDockOpen}>
                                <BottomPanel
                                    panelId={shownBottomPanelId || ""}
                                    onClose={() => setBottomPanelVisible(false)}
                                    height={effective.bottom}
                                />
                            </HostVisibility>
                        </div>
                    </div>

                    {/* Right Sidebar - Always rendered, controlled by CSS visibility */}
                    <div 
                        className={rightDockOpen ? "flex" : "hidden"}
                    >
                        <ResizableHandle direction="horizontal" onResize={handleRightSidebarResize} />
                        <HostVisibility visible={rightDockOpen}>
                            <RightSidebar
                                panelId={shownRightPanelId || ""}
                                onClose={() => setRightSidebarVisible(false)}
                                width={effective.right}
                            />
                        </HostVisibility>
                    </div>

                    {/* Right Sidebar Selector */}
                    <RightSidebarSelector
                        visible={rightDockOpen}
                        activeId={shownRightPanelId}
                        onToggleVisibility={() => setRightSidebarVisible(!rightDockOpen)}
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
                        visible={bottomDockOpen}
                        activeId={shownBottomPanelId}
                        onToggleVisibility={() => setBottomPanelVisible(!bottomDockOpen)}
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
                <LiveSessionFreezeCommands />
                <LintCommands />
                <StoryScriptCommands />
                {narralangUiEnabled() ? <NarralangCommands /> : null}
                <KeybindingCheatSheet />
                {/* Present in a recovery window too: that is the one place an author most needs to be
                    told what is going on, and help reads nothing from the project. */}
                <WorkspaceHelp />
                <EditorClosedTabsKeybinding />
                <WorkspaceUndoKeybindings />
                <WorkspaceHistoryMenu />
                {/* The toast stack is told what it may not reach over. The right selector rail is a
                    permanent column of controls and the status bar is a permanent row of them; a
                    card parked on either takes it away for as long as the card is up. */}
                <NotificationContainer rightInset={RAIL_SELECTOR_WIDTH} bottomInset={statusBarHeight} />
                <DialogContainer />
            </div>
        </TeamProjectProvider>
    );
}
