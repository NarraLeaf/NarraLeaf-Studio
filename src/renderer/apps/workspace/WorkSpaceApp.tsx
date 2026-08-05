import { MissingProjectConfigScreen } from "./components";
import { ErrorScreen } from "./components/ErrorScreen";
import { WorkspaceClosingOverlay } from "./components/WorkspaceClosingOverlay";
import { WorkspaceOpeningOverlay } from "./components/WorkspaceOpeningOverlay";
import { WorkspaceLayout } from "./components/layout";
import { WorkspaceProvider, useWorkspace } from "./context";
import { useModuleLoader } from "./hooks/useModuleLoader";
import { useWorkspaceEditorSession } from "./hooks/useWorkspaceEditorSession";
import { useFileMenu } from "./hooks/useFileMenu";
import { useMenuActionHandler } from "./hooks/useMenuActionHandler";
import { useNativeMenuSync } from "./hooks/useNativeMenuSync";
import { useWorkspacePlugins } from "./hooks/useWorkspacePlugins";
import { useRecoveryOffer } from "./hooks/useRecoveryOffer";
import { RegistryProvider } from "./registry";
import { WorkspaceAssetDragProvider } from "./dnd/WorkspaceAssetDragProvider";
import { PreviewBlueprintNavigateBridge } from "./modules/blueprint-lite/PreviewBlueprintNavigateBridge";
import { StoryRowHighlightBridge } from "./modules/story/scene-editor/StoryRowHighlightBridge";
import { RecoveryShell } from "./recovery/RecoveryShell";
import { isWorkspaceStartupError, WorkspaceStartupErrorKind } from "@/lib/workspace/startup/workspaceProjectPreflight";

/**
 * Main workspace application component
 * Provides context and renders the workspace layout
 */
function WorkspaceContent() {
    // Load all built-in modules (panels, editors, actions)
    useModuleLoader();
    useWorkspacePlugins();
    useRecoveryOffer();
    useWorkspaceEditorSession();
    useFileMenu();
    useMenuActionHandler();
    useNativeMenuSync();

    return (
        <>
            <PreviewBlueprintNavigateBridge />
            <StoryRowHighlightBridge />
            <WorkspaceLayout title="NarraLeaf Studio" iconSrc="/favicon.ico" />
        </>
    );
}

function InitializedWorkspace({ children }: { children: React.ReactNode }) {
    const { isInitialized, error, startupStage, retry, recovery, context } = useWorkspace();

    // Say what is taking the time while the workspace boots. The overlay keeps the window blank for
    // a beat first, so a project that opens instantly still opens straight into the editor.
    if (!isInitialized && !error) {
        return <WorkspaceOpeningOverlay stage={startupStage} />;
    }

    // Show error screen if initialization failed
    if (error) {
        if (isWorkspaceStartupError(error) && error.kind === WorkspaceStartupErrorKind.MissingProjectConfig) {
            return <MissingProjectConfigScreen projectPath={error.projectPath} />;
        }
        return <ErrorScreen error={error} onRetry={retry} />;
    }

    // Ahead of the editor and after the error screen, which is the whole ordering: a recovery shell
    // is what a window becomes when the workspace below it is not to be trusted, so it must not
    // mount the editor - but it is also a window that came up, so it is not an error screen either.
    if (recovery) {
        return (
            <RecoveryShell
                context={context}
                projectPath={context?.project.getConfig().projectPath ?? ""}
            />
        );
    }

    return (<>{children}</>);
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
