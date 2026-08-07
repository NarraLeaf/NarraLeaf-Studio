/**
 * The model the workspace renderer mirrors onto the native application menu (macOS only).
 *
 * The main process cannot derive this itself: which groups exist depends on what the action
 * registry holds (an image tab's Preview group is keyed by its tab id) and which items are
 * visible depends on the current focus. So the renderer computes the model and pushes it up
 * over `workspace.menu.sync`; the main process only lays it out.
 *
 * Nothing here names a concrete group. A group declares *where* it wants to land via `slot`,
 * so the menu bar's layout never has to know which panel produced what.
 */

/**
 * Renderer action ids the native menu drives directly. These are the ids of actions registered
 * in the renderer's action registry - the native menu only names them, the renderer owns what
 * they do (see `useMenuActionHandler`).
 */
export const WorkspaceMenuAction = {
    NewWorkspace: "narraleaf-studio:file-new",
    OpenWorkspace: "narraleaf-studio:file-open",
    ExportProject: "narraleaf-studio:file-export-project",
    CloseWorkspace: "narraleaf-studio:file-close-workspace",
    OpenWelcome: "narraleaf-studio:open-welcome",
    About: "narraleaf-studio:about",
    Build: "narraleaf-studio:build",
    ToggleLeftSidebar: "narraleaf-studio:toggle-left-sidebar",
    ToggleBottomPanel: "narraleaf-studio:toggle-bottom-panel",
    ToggleRightSidebar: "narraleaf-studio:toggle-right-sidebar",
} as const;

export type WorkspaceMenuAction = typeof WorkspaceMenuAction[keyof typeof WorkspaceMenuAction];

/**
 * The Develop menu's run entries, which are palette COMMANDS rather than registry actions.
 *
 * Dev Mode, Preview and Test stopped being standalone toolbar actions when the Run split-button
 * took over launching them, and their launch sequences (flush dirty UI docs, then launch the main
 * surface; open the test picker) live in that control. What survived the move is a set of
 * `run:*` commands registered on the CommandService - so that is what the menu bar names, and
 * `useMenuActionHandler` resolves an id the action registry does not know against those.
 *
 * Run and stop are separate ids, not one toggle: that is how the palette lists them, and the menu
 * already knows which one applies from the runtime status it renders its checkmarks from. Sending
 * a run id at something already running would only be refused by the command's own `when`.
 */
export const WorkspaceRunCommand = {
    RunDevMode: "run:dev-mode",
    StopDevMode: "run:stop-dev-mode",
    RunPreview: "run:preview",
    StopPreview: "run:stop-preview",
    RunTest: "run:test",
    StopTest: "run:stop-test",
} as const;

export type WorkspaceRunCommand = typeof WorkspaceRunCommand[keyof typeof WorkspaceRunCommand];

/**
 * Any registered renderer action id. Menu items synced up from the renderer carry ids the main
 * process cannot know ahead of time (an image tab's preview actions are keyed by tab), so the
 * menu channel is typed as a plain id string; `WorkspaceMenuAction` lists the well-known ones.
 *
 * Ids are only ever minted by the renderer and handed straight back to it, where
 * `useMenuActionHandler` resolves them against the registry and ignores anything unknown.
 */
export type MenuActionId = string;

/**
 * Where a group's items land on the native menu bar.
 *
 * - `top-level` - its own menu, after Edit. The default, and where an image tab's Preview or a
 *   plugin's group goes.
 * - `edit` - merged into the standard Edit menu. macOS convention is to hang context-specific
 *   entries under the standard editing items rather than open a second menu named Edit.
 * - `window` - appended to the standard Window menu, below Minimize/Zoom.
 * - `none` - not mirrored at all. For groups the main process builds natively itself (File,
 *   Help), which would otherwise appear twice.
 */
export type NativeMenuSlot = "top-level" | "edit" | "window" | "none";

/** The slots that actually reach the menu bar; `none` groups are dropped before the sync. */
export type SyncedMenuSlot = Exclude<NativeMenuSlot, "none">;

/**
 * Standard Edit-menu commands a renderer action can stand in for. When the focused surface
 * provides an action tagged with one of these, the native Edit menu routes that command to the
 * action instead of the built-in webContents role - one Copy in the menu, not two.
 */
export type EditMenuRole = "copy" | "cut" | "paste" | "delete" | "undo" | "redo";

/**
 * Serializable mirror of one renderer action-registry menu item. Only what a native menu needs:
 * no icons, no React, no callbacks - clicks travel back as `id`.
 */
export type NativeMenuItem =
    | { kind: "separator" }
    | {
        kind: "action";
        id: MenuActionId;
        label: string;
        enabled: boolean;
        /** Present for toggles; renders as a native checkbox item. */
        checked?: boolean;
        /** Present when this action replaces a standard Edit-menu command (see EditMenuRole). */
        role?: EditMenuRole;
    }
    | {
        kind: "submenu";
        label: string;
        items: NativeMenuItem[];
    };

/** Serializable mirror of one renderer action group, already filtered to the current focus. */
export type NativeMenuGroup = {
    id: string;
    label: string;
    slot: SyncedMenuSlot;
    items: NativeMenuItem[];
};

/**
 * Runtime state the Develop menu needs. The main process builds that menu itself - its actions are
 * well-known - but what is currently running is only known to the renderer's services, so the
 * status rides along with the menu sync.
 *
 * Dev Mode and Preview use it for their checkmarks; all three use it to decide whether the item
 * means run or stop, which is what keeps the menu from ever holding an entry that does nothing.
 */
export type NativeMenuRuntimeStatus = {
    devModeActive: boolean;
    previewActive: boolean;
    /** A test run holds the run slot exactly as a mode does, so the Test entry becomes Stop too. */
    testActive: boolean;
    /**
     * Whether the project is frozen, which is what turns Preview and Production Build off.
     *
     * Sent up so the menu can grey them the way the toolbar does. The commands behind them refuse
     * a frozen workspace on their own, but a refusal the user cannot see reads as a broken menu.
     */
    frozen: boolean;
};

/** Everything one workspace window pushes up for its native menu. */
export type NativeMenuModel = {
    groups: NativeMenuGroup[];
    runtime: NativeMenuRuntimeStatus;
};
