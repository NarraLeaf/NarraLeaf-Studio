import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { normalizeMobileConfiguration } from "@/lib/workspace/project/configuration";
import type { SafeAreaMobileOrientation } from "@/lib/ui-editor/preview/surfacePreviewFrames";
import {
  normalizeGameRuntimeViewportConfig,
  type GameRuntimeViewportConfig
} from "@shared/types/gameRuntime";

/**
 * The project's `app.mobile.orientation` — the rotation the mobile shells actually lock to
 * (`setRequestedOrientation` on Android, `UISupportedInterfaceOrientations` on iOS).
 *
 * Read on every call rather than memoized: it comes from `ProjectService`'s already-parsed config
 * object, so it costs nothing, and the Project panel can change it while a surface tab is open —
 * a cached copy would leave the safe-area frame describing the old rotation with no way to notice.
 *
 * Falls back to `auto` (i.e. "let the design size decide") whenever the config cannot be read, which
 * is the same answer a project that has never touched the setting deserves.
 */
export function readProjectMobileOrientation(
  context: WorkspaceContext | null | undefined
): SafeAreaMobileOrientation {
  if (!context) {
    return "auto";
  }
  try {
    const config = context.services.get<ProjectService>(Services.Project).getProjectConfig();
    return normalizeMobileConfiguration(config.app?.mobile).orientation;
  } catch {
    // Services can be mid-initialization; a missing orientation is not worth a thrown render.
    return "auto";
  }
}

/**
 * The project's `app.mobile` stage fit + crop anchor, for a Dev Mode launch entry.
 *
 * Same read-every-call reasoning as {@link readProjectMobileOrientation}: this is only ever called
 * at launch, and a cached copy would open a window that crops the way the project used to.
 */
export function readProjectViewportConfig(
  context: WorkspaceContext | null | undefined
): GameRuntimeViewportConfig {
  if (!context) {
    return normalizeGameRuntimeViewportConfig(undefined);
  }
  try {
    const config = context.services.get<ProjectService>(Services.Project).getProjectConfig();
    return normalizeGameRuntimeViewportConfig(config.app?.mobile);
  } catch {
    return normalizeGameRuntimeViewportConfig(undefined);
  }
}

/**
 * The project's `app.mobile.fit`, for the canvas frames.
 *
 * The frames describe what a player gets, so they have to know whether the build letterboxes or
 * crops — under `cover` there are no bars, and the bars are exactly what used to absorb a device
 * inset before it reached the content.
 */
export function readProjectStageFit(
  context: WorkspaceContext | null | undefined
): GameRuntimeViewportConfig["fit"] {
  return readProjectViewportConfig(context).fit;
}
