import {
    Package,
    FileText,
    FolderOpen,
    X,
    Archive,
} from "lucide-react";
import { ModuleAction, ModuleActionGroup } from "../types";
import { Workspace } from "@/lib/workspace/workspace";
import { UIService } from "@/lib/workspace/services/ui";
import { Services } from "@/lib/workspace/services/services";
import { openWelcomeTab } from "../welcome/openWelcomeTab";
import { openAboutTab } from "../about/openAboutTab";
import { getInterface } from "@/lib/app/bridge";
import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { Separator } from "../../registry/types";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import { openBuildDialog } from "./BuildDialog";
import { translate, translateN } from "@/lib/i18n";

/**
 * Global toolbar actions
 * These actions are always available in the top action bar
 */

/**
 * Build project action
 * Opens the production build dialog for the current project.
 *
 * Dev Mode and Preview are no longer standalone actions — the toolbar's Run split-button
 * ({@link RunControl}) owns launching and stopping both. **Production Build is now folded into that
 * button's dropdown too**, to make room in the title bar for the version control widget, so
 * nothing renders this action's icon in the bar any more.
 *
 * It stays REGISTERED regardless, and that is load-bearing rather than tidiness: the macOS native
 * Dev ▸ Build menu item resolves through the action registry (`useMenuActionHandler` looks the id up
 * and calls this `onClick`), the command palette derives its Build entry from the same registry, and
 * `freezeActionPolicy` decides through it that a frozen workspace cannot build. Unregistering would
 * have broken all three, and only on macOS for the first. `ActionBar` skips rendering it by id
 * instead - see `ACTIONS_OWNED_BY_RUN_CONTROL` there.
 *
 * The icon is a plain glyph, not a live status component. The build's status - and the done/failed
 * notifications that used to be raised from inside the icon - moved to {@link RunControl}, which is
 * always mounted: an effect living in an icon fired once per place the icon was rendered, so a build
 * that finished while the command palette was open announced itself twice.
 */
export const buildAction: ModuleAction = {
    id: "narraleaf-studio:build",
    icon: <Package className="w-4 h-4" />,
    tooltip: "Build project",
    tooltipKey: "actions.build.tooltip",
    // Standalone, so it carries its own palette category — it belongs beside Run Dev Mode and Run
    // Preview, which is where an author looks for it.
    paletteCategoryKey: "workspace.shell.commandPalette.categoryRun",
    onClick: (workspace: Workspace) => {
        void openBuildDialog(workspace);
    },
    order: 4,
};

/**
 * File action group
 * Contains file-related actions like new, open, save
 */
export const fileActionGroup: ModuleActionGroup = {
    id: "narraleaf-studio:file",
    label: "File",
    labelKey: "actions.file.label",
    order: 10,
    // The macOS File menu is built natively so it can carry Cmd+N/Cmd+O; mirroring this group
    // would leave the menu bar with two File menus.
    menuSlot: "none",
    actions: [
        {
            id: "narraleaf-studio:file-new",
            label: "New Workspace",
            labelKey: "actions.file.new.label",
            icon: <FileText className="w-4 h-4" />,
            tooltip: "Create a new workspace",
            tooltipKey: "actions.file.new.tooltip",
            onClick: () => {
                void (async () => {
                    const result = await getInterface().app.launchProjectWizard({});
                    if (result.success && result.data?.created) {
                        // Opens alongside: File ▸ New is not a request to close this project.
                        await getInterface().workspace.launch({ projectPath: result.data.projectPath });
                    }
                })();
            },
            order: 0,
        },
        {
            id: "narraleaf-studio:file-open",
            label: "Open Workspace",
            labelKey: "actions.file.open.label",
            icon: <FolderOpen className="w-4 h-4" />,
            tooltip: "Open an existing workspace",
            tooltipKey: "actions.file.open.tooltip",
            onClick: () => {
                void (async () => {
                    const result = await getInterface().selectFolder();
                    if (!result.success || !result.data?.path) return;
                    // A switch: this window is retired once the chosen project loads (it is focused
                    // instead if some other window already has it). Same rule as the title-bar
                    // switcher - going to another project is going there, not opening a second
                    // window - while File ▸ New above still opens alongside.
                    await getInterface().workspace.launch({ projectPath: result.data.path }, true);
                })();
            },
            order: 1,
        },
        {
            id: "narraleaf-studio:file-export-project",
            label: "Export Project",
            labelKey: "actions.file.export.label",
            icon: <Archive className="w-4 h-4" />,
            tooltip: "Export the current project as a package",
            tooltipKey: "actions.file.export.tooltip",
            onClick: (workspace: Workspace) => {
                void (async () => {
                    const context = workspace.getContext();
                    const uiService = context.services.get<UIService>(Services.UI);

                    // Refresh the plugin dependency table so the exported package
                    // records exactly which plugins this project needs. Best-effort:
                    // a scan failure must not block the export itself.
                    //
                    // Deferred rather than attempted while the project is frozen. Exporting is
                    // one of the two things File keeps alive on a frozen workspace, and nobody
                    // asked for this write - so on a frozen project it only raised "Nothing is
                    // being saved right now" about the export's own bookkeeping. The table
                    // already on disk is exported instead, and the rescan lands on the next
                    // export once the workspace is writable again.
                    if (getProjectWriteFreeze() === null) {
                        try {
                            await context.services
                                .get<ProjectDependencyService>(Services.ProjectDependency)
                                .rescanAndPersist();
                        } catch (error) {
                            console.warn("[export] plugin dependency rescan failed", error);
                        }
                    }

                    uiService.showNotification(translate("actions.export.chooseFolder"), "info");

                    const projectPath = context.project.getConfig().projectPath;
                    const result = await getInterface().workspace.exportProjectPackage(projectPath);
                    if (!result.success) {
                        uiService.showNotification(result.error || translate("actions.export.failed"), "error");
                        return;
                    }
                    if (result.data.canceled) {
                        return;
                    }

                    const fileCount = result.data.fileCount ?? 0;
                    uiService.showNotification(translateN("actions.export.success", fileCount), "success");
                })();
            },
            order: 2,
        },
        Separator,
        {
            id: "narraleaf-studio:file-close-workspace",
            label: "Close",
            labelKey: "common.close",
            icon: <X className="w-4 h-4" />,
            tooltip: "Close the current workspace",
            tooltipKey: "actions.file.close.tooltip",
            onClick: () => {
                getInterface().workspace.close();
            },
            order: 3,
        },
    ],
};

export const helpActionGroup: ModuleActionGroup = {
    id: "narraleaf-studio:help",
    label: "Help",
    labelKey: "actions.help.label",
    order: 30,
    // Built natively as the standard macOS Help menu (see fileActionGroup).
    menuSlot: "none",
    actions: [
        {
            id: "narraleaf-studio:open-welcome",
            label: "Open Welcome",
            labelKey: "actions.help.welcome.label",
            tooltip: "Open welcome screen",
            tooltipKey: "actions.help.welcome.tooltip",
            onClick: (workspace: Workspace) => {
                openWelcomeTab(workspace.getContext());
            },
            order: 0,
        },
        {
            id: "narraleaf-studio:about",
            label: "About",
            labelKey: "actions.help.about.label",
            tooltip: "About NarraLeaf Studio",
            tooltipKey: "actions.help.about.tooltip",
            onClick: (workspace: Workspace) => {
                openAboutTab(workspace.getContext());
            },
            order: 1,
        },
    ],
};

/**
 * All global actions
 * Array of all actions that should be registered globally
 */
export const globalActions: ModuleAction[] = [buildAction];

/**
 * All global action groups
 * Array of all action groups that should be registered globally
 *
 * `fileActionGroup` is deliberately absent: it is registered by `useFileMenu`, which owns it so
 * the "Open Recent" submenu can track the project history live without two writers racing for the
 * same id. Its definition above stays the single source of the File group's New/Open/Export/Close.
 */
export const globalActionGroups: ModuleActionGroup[] = [helpActionGroup];
