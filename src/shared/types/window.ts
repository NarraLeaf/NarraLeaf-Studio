
import type { CommandLineRunJob } from "./commandLineRun";
import type { PluginPermissionPromptProps, PluginPermissionPromptResult } from "./pluginPermissions";
import type { ServerTrustPromptProps, ServerTrustPromptResult } from "./serverTrust";
import type { ProjectTrustPromptProps, ProjectTrustPromptResult } from "./projectTrust";

export enum WindowAppType {
    Launcher = "launcher",
    Settings = "settings",
    Workspace = "workspace",
    ProjectWizard = "project-wizard",
    DevMode = "dev-mode",
    PluginPermissionPrompt = "plugin-permission",
    ServerTrustPrompt = "server-trust",
    ProjectTrustPrompt = "project-trust",
    Raw = "raw",
}

export type WindowProps = {
    [WindowAppType.Launcher]: {
        /**
         * Open in first-run setup instead of on the home screen.
         *
         * A window prop rather than something the renderer works out for itself, for the reason
         * `recovery` below gives: the decision is available synchronously in the main process
         * (the marker is one `globalState.get`), and handing it over with the window means the
         * first frame is already the right one. Read it in the renderer and the home screen paints
         * first, then gets replaced - which is exactly the flash a first launch should not have.
         */
        onboarding?: boolean;
    },
    [WindowAppType.Settings]: {
        /** A setting key (or category key) to select and scroll to on open. */
        highlight?: string;
    },
    [WindowAppType.Workspace]: {
        projectPath: string;
        /**
         * Open this project as a recovery shell instead of as a workspace.
         *
         * A window prop rather than renderer state because the mode is decided by a *reload*: the
         * whole point is to throw away whatever the failed boot left in memory and come back with a
         * different startup. `workspace.setRecoveryMode` writes it here and reloads the window, so
         * the flag is the first thing the new renderer reads and nothing has to be told twice.
         */
        recovery?: boolean;
        /**
         * What sent the author here, verbatim.
         *
         * The failure that made recovery mode worth entering usually happened in the renderer that
         * is about to be discarded - most often the workspace init error behind the error screen -
         * and re-deriving it after the reload is not always possible (a service that threw on the
         * first read may quietly succeed on the second). Carried across so the recovery panel can
         * list it as the first anomaly.
         */
        recoveryReason?: string;
        /**
         * Run this job and report the result, instead of opening the editor.
         *
         * Set only by `--build`, `--test` and `--lint`. A window prop rather than a message sent
         * once the window is up, for the reason `recovery` above gives from the other side: it is
         * settled before the first service starts, so the workspace can come up as the thing it is
         * going to be. In this mode the shell, the tabs, the plugins and the built-in modules are
         * never mounted - the checks, the build and the tests need services, not an interface, and
         * an interface nobody can see costs a minute of startup and brings dialogs with nobody to
         * answer them.
         */
        commandLineRun?: CommandLineRunJob;
        /**
         * A live session this window should join as soon as its services are up.
         *
         * Set by the launcher, which is where every way into somebody else's room lives: joining
         * one usually means getting the project first, and getting a project is the launcher's
         * flow. **The launcher cannot join on this window's behalf** - membership in a room is
         * recorded per instance, and a launcher window is a different instance from the workspace
         * it opens - so it finds out which room is meant and hands the intent over here.
         *
         * Either the room's id, for one picked off a server's list, or the four digits, for one
         * whose host read them out. They are not interchangeable: a room joined by passcode is
         * not on any list and refuses its own id, which is the whole of what that rule buys.
         *
         * ⚠ **Taken up once.** The workspace clears it through `workspace.liveIntentTaken` before
         * acting, because props outlive a reload - and a window that reloaded an hour after its
         * author left the room would otherwise walk straight back into it.
         */
        joinLive?: { session: string } | { code: string };
    },
    [WindowAppType.ProjectWizard]: {
        /**
         * A `.nlspkg` the wizard should open on, already chosen.
         *
         * Set when Studio was asked to open a package file directly - a double-click in the file
         * manager, or a second launch handing one to the running instance. The wizard starts on
         * the import flow with this package selected instead of on the origin page, because the
         * author has already answered the question that page asks.
         *
         * The path is granted to this window by the main process before the window loads; the
         * renderer never resolves it and never picks it up from anywhere else.
         */
        packagePath?: string;
        /**
         * A repository the wizard should open on, already filled in.
         *
         * The sibling of {@link packagePath}, and set for the same reason: the author has
         * already chosen the project - off a server's list in the launcher, or by making one
         * there a moment ago - so the wizard starts on the clone flow with this address rather
         * than asking a first-page question that has been answered.
         *
         * The whole remote, `lore://host:port/name`, as the server lists it. Where the copy
         * lands is still asked, because that is the one thing the wizard is for: the
         * destination goes through the native picker, which is the only way a folder can be
         * written to at all.
         */
        remoteUrl?: string;
        /**
         * The server a project made here is going on to, when it was started from one.
         *
         * **This is not a third flow.** The project is written on this disk exactly as any
         * other project is, and the server is what happens to it afterwards - the launcher
         * sends it once the wizard hands back a path. What the wizard does with this is only
         * what the author would otherwise have to remember: the origin is settled (a project
         * on a server is one made here, not one fetched), version control is settled (an
         * unversioned project has nothing to send), and the review page names the server.
         *
         * Nothing is created on the server before the project exists. A wizard closed without
         * finishing leaves that server exactly as it was.
         */
        publishTo?: {
            /** The server's data origin, `lore://host:port`, as its session is keyed by. */
            remoteOrigin: string;
            /** What that server calls itself, for the one line that names it. */
            server: string;
        };
    },
    [WindowAppType.DevMode]: {
        projectPath: string;
        entry: import("./devMode").DevModeEntry;
    },
    [WindowAppType.PluginPermissionPrompt]: PluginPermissionPromptProps,
    [WindowAppType.ServerTrustPrompt]: ServerTrustPromptProps,
    [WindowAppType.ProjectTrustPrompt]: ProjectTrustPromptProps,
    [WindowAppType.Raw]: {
    },
}

/**
 * A request named a project that is not the one its window has open.
 *
 * Carried as a `RequestStatus.code` so a renderer can tell this apart from an ordinary failure of
 * the same operation without reading the English sentence beside it. Nothing in the interface has a
 * remedy to offer for it: every legitimate caller sends back the `projectPath` it was given in its
 * own window props, so this arrives only from a renderer that has gone wrong or one that is being
 * driven. It is a code rather than prose so that a log, a test and a future diagnostic can all agree
 * on what happened.
 */
export const WINDOW_PROJECT_MISMATCH_CODE = "window/project-mismatch";

/**
 * What happens to a window that was opened *from* another one when that other one goes away.
 *
 * `"dependent"` is the answer for a prompt: it asks a question on behalf of the window that raised
 * it, so once that window is gone there is nobody left for the answer to reach. It goes with its
 * parent, reporting "no answer" to whoever was waiting.
 *
 * `"independent"` is the answer for everything the author is *doing* rather than answering. The
 * project wizard is the case that named this: it is opened from the launcher, and the launcher
 * retires itself the moment a project opens - so a wizard half filled in used to be destroyed by a
 * window that had nothing to do with it. An independent child is detached from its parent instead
 * and stays on screen.
 *
 * This is Studio's own bookkeeping *and* Electron's: a `parent` in the constructor options makes
 * Chromium destroy the child with the parent regardless of what we think, so an independent child
 * has to be handed `setParentWindow(null)` while both windows still exist.
 */
export type ChildWindowLifetime = "dependent" | "independent";

export type WindowVisibilityStatus = "minimized" | "maximized" | "normal";

/**
 * A surface the Settings window can ask a workspace to reveal, because it lives in the workspace
 * and needs its live state (the background dialog's preview) - Settings can only ask; see
 * `app.requestWorkspaceView`.
 */
export type WorkspaceViewRequest = "backgroundImage";

export enum WindowControlPolicy {
    Standard = "standard",
    MacNativeOutsideTitleBar = "mac-native-outside-titlebar",
    None = "none",
}

export interface WindowControlAbility {
    minimizable: boolean;
    maximizable: boolean;
    closable: boolean;
    resizable: boolean;
    movable: boolean;
    fullscreenable: boolean;
}

export type WindowLuanchOptions = {
    modal: boolean;
    child: boolean;
};

/**
 * Window close result types for each window type
 * Defines the return value type when a window is closed with closeWith()
 */
export type WindowCloseResults = {
    [WindowAppType.Launcher]: null;
    [WindowAppType.Settings]: null;
    [WindowAppType.Workspace]: null;
    /**
     * The name and the app id come back with the path because the caller may still have work
     * to do on the project once the window is gone - sending it to a server is the case that
     * put them here - and by then both are inside a MessagePack file.
     *
     * **They are not interchangeable.** The name is what the project calls itself and is read
     * by people; the app id is `[a-z0-9-]+` and is what a machine can be told. A repository
     * name is the second kind: `lore://host:port/<name>` has no room for a space and a server
     * refuses one outright, so a project called "My Game" is registered as `my-game`.
     *
     * Both are absent for the two flows that chose neither: a clone and an import are named
     * by what arrived.
     */
    [WindowAppType.ProjectWizard]:
        { created: boolean; projectPath: string; projectName?: string; appId?: string }
        | null;
    [WindowAppType.DevMode]: null;
    [WindowAppType.PluginPermissionPrompt]: PluginPermissionPromptResult;
    [WindowAppType.ServerTrustPrompt]: ServerTrustPromptResult;
    [WindowAppType.ProjectTrustPrompt]: ProjectTrustPromptResult;
    [WindowAppType.Raw]: null;
};
