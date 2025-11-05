import { WorkspaceProvider, useWorkspace } from "./context";
import { RegistryProvider } from "./registry";
import { WorkspaceLayout } from "./components/layout";
import { LoadingScreen } from "./components/LoadingScreen";
import { ErrorScreen } from "./components/ErrorScreen";
import { useModuleLoader } from "./hooks/useModuleLoader";

/**
 * Main workspace application component
 * Provides context and renders the workspace layout
 */
function WorkspaceContent() {
    const { isInitialized, error } = useWorkspace();

    // Load all built-in modules (panels, editors, actions)
    useModuleLoader();

    // Show loading screen while initializing
    if (!isInitialized && !error) {
        // return <LoadingScreen message="Initializing workspace..." />;
        return <></>;
    }

    // Show error screen if initialization failed
    if (error) {
        return <ErrorScreen error={error} />;
    }

    return <WorkspaceLayout title="NarraLeaf Studio" iconSrc="/favicon.ico" />;
}

/**
 * Workspace app with providers
 */
export function WorkSpaceApp() {
    return (
        <WorkspaceProvider>
            <RegistryProvider>
                <WorkspaceContent />
            </RegistryProvider>
        </WorkspaceProvider>
    );
}

export default WorkSpaceApp;