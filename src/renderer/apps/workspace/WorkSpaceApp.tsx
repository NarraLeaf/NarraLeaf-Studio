import { MissingProjectConfigScreen } from "./components";
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
import {
  isWorkspaceStartupError,
  WorkspaceStartupErrorKind
} from "@/lib/workspace/startup/workspaceProjectPreflight";

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
      <WorkspaceLayout title="NarraLeaf Studio" iconSrc="/favicon.ico" />
    </>
  );
}

function InitializedWorkspace({ children }: { children: React.ReactNode }) {
  const { isInitialized, error, startupStage, retry } = useWorkspace();

  // Say what is taking the time while the workspace boots. The overlay keeps the window blank for
  // a beat first, so a project that opens instantly still opens straight into the editor.
  if (!isInitialized && !error) {
    return <WorkspaceOpeningOverlay stage={startupStage} />;
  }

  // Show error screen if initialization failed
  if (error) {
    if (
      isWorkspaceStartupError(error) &&
      error.kind === WorkspaceStartupErrorKind.MissingProjectConfig
    ) {
      return <MissingProjectConfigScreen projectPath={error.projectPath} />;
    }
    return <ErrorScreen error={error} onRetry={retry} />;
  }

  return <>{children}</>;
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
