import { LoadingScreen, MissingProjectConfigScreen } from "./components";
import { ErrorScreen } from "./components/ErrorScreen";
import { WorkspaceLayout } from "./components/layout";
import { WorkspaceProvider, useWorkspace } from "./context";
import { useModuleLoader } from "./hooks/useModuleLoader";
import { useWorkspaceEditorSession } from "./hooks/useWorkspaceEditorSession";
import { useMenuActionHandler } from "./hooks/useMenuActionHandler";
import { useWorkspacePlugins } from "./hooks/useWorkspacePlugins";
import { RegistryProvider } from "./registry";
import { WorkspaceAssetDragProvider } from "./dnd/WorkspaceAssetDragProvider";
import { PreviewBlueprintNavigateBridge } from "./modules/blueprint-lite/PreviewBlueprintNavigateBridge";
import { isWorkspaceStartupError, WorkspaceStartupErrorKind } from "@/lib/workspace/startup/workspaceProjectPreflight";

/**
 * Main workspace application component
 * Provides context and renders the workspace layout
 */
function WorkspaceContent() {
    // Load all built-in modules (panels, editors, actions)
    useModuleLoader();
    useWorkspacePlugins();
    useWorkspaceEditorSession();
    useMenuActionHandler();

    return (
        <>
            <PreviewBlueprintNavigateBridge />
            <WorkspaceLayout title="NarraLeaf Studio" iconSrc="/favicon.ico" />
        </>
    );
}

function InitializedWorkspace({ children }: { children: React.ReactNode }) {
    const { isInitialized, error } = useWorkspace();

    // Show loading screen while initializing
    if (!isInitialized && !error) {
        // return <LoadingScreen message="Initializing workspace..." />;
        return <></>;
    }

    // Show error screen if initialization failed
    if (error) {
        if (isWorkspaceStartupError(error) && error.kind === WorkspaceStartupErrorKind.MissingProjectConfig) {
            return <MissingProjectConfigScreen projectPath={error.projectPath} />;
        }
        return <ErrorScreen error={error} />;
    }

    return (<>{children}</>);
}

/**
 * Workspace app with providers
 */
export function WorkSpaceApp() {
    return (
        <WorkspaceProvider>
            <InitializedWorkspace>
                <RegistryProvider>
                    <WorkspaceAssetDragProvider>
                        <WorkspaceContent />
                    </WorkspaceAssetDragProvider>
                </RegistryProvider>
            </InitializedWorkspace>
        </WorkspaceProvider>
    );
}

export default WorkSpaceApp;
