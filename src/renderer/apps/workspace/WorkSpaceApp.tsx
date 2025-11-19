import { LoadingScreen } from "./components";
import { ErrorScreen } from "./components/ErrorScreen";
import { WorkspaceLayout } from "./components/layout";
import { WorkspaceProvider, useWorkspace } from "./context";
import { useModuleLoader } from "./hooks/useModuleLoader";
import { RegistryProvider } from "./registry";

/**
 * Main workspace application component
 * Provides context and renders the workspace layout
 */
function WorkspaceContent() {
    // Load all built-in modules (panels, editors, actions)
    useModuleLoader();

    return <WorkspaceLayout title="NarraLeaf Studio" iconSrc="/favicon.ico" />;
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
                    <WorkspaceContent />
                </RegistryProvider>
            </InitializedWorkspace>
        </WorkspaceProvider>
    );
}

export default WorkSpaceApp;