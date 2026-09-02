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
import { RegistryProvider } from "./registry";
import { WorkspaceAssetDragProvider } from "./dnd/WorkspaceAssetDragProvider";
import { DetachedEditorsHost } from "./detached/DetachedEditorsHost";
import { PreviewBlueprintNavigateBridge } from "./modules/blueprint-lite/PreviewBlueprintNavigateBridge";
import { StoryRowHighlightBridge } from "./modules/story/scene-editor/StoryRowHighlightBridge";
import { DevModeStoryRowOpenBridge } from "./modules/story/scene-editor/DevModeStoryRowOpenBridge";
import { isProjectLockedError, isWorkspaceStartupError, WorkspaceStartupErrorKind } from "@/lib/workspace/startup/workspaceProjectPreflight";
import { CommandLineBuildHost } from "./CommandLineBuildHost";

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
    const { isInitialized, error, startupStage, retry, commandLineBuild } = useWorkspace();

    // A window opened by `--build` never becomes an editor. Ahead of the two screens below because
    // it has to answer them too: an overlay this window cannot show would leave the launch waiting
    // for a build that was never going to start, and an error screen would do the same silently.
    if (commandLineBuild) {
        return <CommandLineBuildGate isInitialized={isInitialized} error={error} />;
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

/**
 * The whole of what a command-line build window renders.
 *
 * Three states and no interface: still starting (wait), failed to start (say so, and let the
 * provider's own `reportLoadResult(false)` end the run), or ready to build.
 */
function CommandLineBuildGate({ isInitialized, error }: { isInitialized: boolean; error: Error | null }) {
    if (error || !isInitialized) {
        return null;
    }
    return <CommandLineBuildHost />;
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
