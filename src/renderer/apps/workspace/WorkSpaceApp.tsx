import { MissingProjectConfigScreen, ProjectLockedScreen } from "./components";
import { ErrorScreen } from "./components/ErrorScreen";
import { WorkspaceClosingOverlay } from "./components/WorkspaceClosingOverlay";
import { WorkspaceOpeningOverlay } from "./components/WorkspaceOpeningOverlay";
import { EditableTextContextMenu } from "./components/EditableTextContextMenu";
import { WorkspaceLayout } from "./components/layout";
import { WorkspaceProvider, useWorkspace } from "./context";
import { useModuleLoader } from "./hooks/useModuleLoader";
import { useWorkspaceEditorSession } from "./hooks/useWorkspaceEditorSession";
import { useFileMenu } from "./hooks/useFileMenu";
import { useMenuActionHandler } from "./hooks/useMenuActionHandler";
import { useNativeMenuSync } from "./hooks/useNativeMenuSync";
import { useWorkspacePlugins } from "./hooks/useWorkspacePlugins";
import { useRecoveryOffer } from "./hooks/useRecoveryOffer";
import { useUpdateOffer } from "./hooks/useUpdateOffer";
import { useDependencyOffer } from "./hooks/useDependencyOffer";
import { useProjectTakenOver } from "./hooks/useWorkspaceFrozen";
import { RegistryProvider } from "./registry";
import { WorkspaceAssetDragProvider } from "./dnd/WorkspaceAssetDragProvider";
import { DetachedEditorsHost } from "./detached/DetachedEditorsHost";
import { PreviewBlueprintNavigateBridge } from "./modules/blueprint-lite/PreviewBlueprintNavigateBridge";
import { StoryRowHighlightBridge } from "./modules/story/scene-editor/StoryRowHighlightBridge";
import { DevModeStoryRowOpenBridge } from "./modules/story/scene-editor/DevModeStoryRowOpenBridge";
import { isProjectLockedError, isWorkspaceStartupError, WorkspaceStartupErrorKind } from "@/lib/workspace/startup/workspaceProjectPreflight";
import { CommandLineRunHost } from "./CommandLineRunHost";

/**
 * Main workspace application component
 * Provides context and renders the workspace layout
 */
function WorkspaceContent() {
    const { recovery } = useWorkspace();

    // Load all built-in modules (panels, editors, actions)
    useModuleLoader();
    useWorkspacePlugins();
    useRecoveryOffer();
    useUpdateOffer();
    useDependencyOffer();
    // Tabs are not restored into a recovery window. The session on disk names scenes, surfaces and
    // characters, and in this mode most of those services have not started - so restoring would
    // reopen a screenful of tabs that can only report that their subject is missing, over the one
    // panel that can say why.
    useWorkspaceEditorSession({ enabled: !recovery });
    useFileMenu();
    useMenuActionHandler();
    useNativeMenuSync();

    return (
        <>
            <DetachedEditorsHost />
            <PreviewBlueprintNavigateBridge />
            <StoryRowHighlightBridge />
            <DevModeStoryRowOpenBridge />
            <EditableTextContextMenu />
            <WorkspaceLayout title="NarraLeaf Studio" />
        </>
    );
}

function InitializedWorkspace({ children }: { children: React.ReactNode }) {
    const { isInitialized, error, startupStage, retry, commandLineRun } = useWorkspace();
    const takenOverBy = useProjectTakenOver();

    // A window opened by `--build`, `--test` or `--lint` never becomes an editor. Ahead of the two
    // screens below because it has to answer them too: an overlay this window cannot show would
    // leave the launch waiting for a run that was never going to start, and an error screen would
    // do the same silently.
    if (commandLineRun) {
        return <CommandLineRunGate isInitialized={isInitialized} error={error} />;
    }

    // Another NarraLeaf Studio has taken this project over, and this window stopped writing the
    // moment it heard. The editor goes rather than staying up frozen: an author left typing into a
    // workspace that silently keeps nothing loses exactly the work this screen exists to protect,
    // and there is no state of this window to return to - it no longer has the project.
    //
    // Ahead of the opening overlay because a takeover can land mid-startup, and ahead of the error
    // screens because it is the newer, truer account of this window. Retry reloads the window
    // rather than re-running the startup in place: the latch that refuses every write belongs to
    // this renderer and is deliberately never lifted within it, so the way back to a workspace that
    // may write is a fresh one - which claims the project again, and lands on the ordinary lock
    // screen while the other Studio still has it.
    if (takenOverBy) {
        return <ProjectLockedScreen holder={takenOverBy} takenOver onRetry={reopenHere} />;
    }

    // Say what is taking the time while the workspace boots. The overlay keeps the window blank for
    // a beat first, so a project that opens instantly still opens straight into the editor.
    if (!isInitialized && !error) {
        return <WorkspaceOpeningOverlay stage={startupStage} />;
    }

    // Show error screen if initialization failed
    if (error) {
        // Ahead of the generic screen because this window is not broken: the project it was opened
        // on belongs to another NarraLeaf Studio for as long as that one holds it, and nothing here
        // may write to it in the meantime. Retry is a fresh claim, which is why it is still offered.
        if (isProjectLockedError(error)) {
            return <ProjectLockedScreen holder={error.holder} onRetry={retry} />;
        }
        if (isWorkspaceStartupError(error) && error.kind === WorkspaceStartupErrorKind.MissingProjectConfig) {
            return <MissingProjectConfigScreen projectPath={error.projectPath} />;
        }
        return <ErrorScreen error={error} onRetry={retry} />;
    }

    return (<>{children}</>);
}

/** Load this window again from nothing, which asks for the project afresh. */
function reopenHere(): void {
    window.location.reload();
}

/**
 * The whole of what a command-line run's window renders.
 *
 * Three states and no interface: still starting (wait), failed to start (say so, and let the
 * provider's own `reportLoadResult(false)` end the run), or ready to do the job.
 */
function CommandLineRunGate({ isInitialized, error }: { isInitialized: boolean; error: Error | null }) {
    if (error || !isInitialized) {
        return null;
    }
    return <CommandLineRunHost />;
}

/**
 * Workspace app with providers
 */
export function WorkSpaceApp() {
    return (
        <>
            <WorkspaceProvider>
                <InitializedWorkspace>
                    <RegistryProvider>
                        <WorkspaceAssetDragProvider>
                            <WorkspaceContent />
                        </WorkspaceAssetDragProvider>
                    </RegistryProvider>
                </InitializedWorkspace>
            </WorkspaceProvider>
            {/* Outside the provider: a window that is still loading, or showing the error screen,
                takes just as long to close as one with a project open in it. */}
            <WorkspaceClosingOverlay />
        </>
    );
}

export default WorkSpaceApp;
