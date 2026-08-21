import { useCallback, useSyncExternalStore } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { DEFAULT_VFX_FRAME_RATE, normalizeVfxConfiguration, type VfxFrameRate } from "@shared/types/vfx";

/**
 * The frame rate this project bakes its screen effects at, kept current.
 *
 * Subscribed rather than read once because the surface that needs it and the surface that changes
 * it are on screen together: the story inspector's preview is a side panel and Project -> App is
 * another, so an author can move the rate while watching the effect it applies to. Reading on mount
 * would leave that preview showing the previous rate until something unrelated remounted it, which
 * is indistinguishable from the setting not working.
 *
 * A number rather than the configuration object, and that is load-bearing twice over.
 * `useSyncExternalStore` compares snapshots by identity, so a fresh object per call would be an
 * infinite render loop; and every write to `.nlproj` rebuilds the stored config wholesale, so even
 * the stored object's identity changes when some unrelated setting is saved. A number is equal to
 * itself, so the icon, the version and the network policy all pass through here silently.
 */
export function useProjectVfxFrameRate(): VfxFrameRate {
    const { context } = useWorkspace();
    const projectService = context?.services.get<ProjectService>(Services.Project) ?? null;

    const subscribe = useCallback(
        (onChange: () => void) => projectService?.onConfigChanged(onChange) ?? (() => undefined),
        [projectService],
    );
    const getSnapshot = useCallback(() => {
        try {
            return normalizeVfxConfiguration(projectService?.getProjectConfig().app?.vfx).frameRate;
        } catch {
            // A window whose project config has not been read yet. The default is not a placeholder
            // here: it is the same answer a project that never opened the setting gives, so nothing
            // downstream has a second case to handle.
            return DEFAULT_VFX_FRAME_RATE;
        }
    }, [projectService]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
