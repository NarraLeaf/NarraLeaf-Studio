import type { AppEventToken } from "@shared/types/app";
import type { ProjectSessionHolder } from "@shared/types/projectSession";
import { WindowAppType } from "@shared/types/window";
import { getInterface } from "@/lib/app/bridge";
import { freezeProjectWrites } from "@/lib/app/writeFreeze";

/**
 * Stop this window writing its project the moment main says another NarraLeaf Studio has taken it
 * over.
 *
 * Main finds out on its session heartbeat: the claim it wrote into the project has been replaced
 * by another Studio's, which means that Studio judged this one gone - its heartbeat stood still for
 * the whole staleness window - and opened the project. Every document this window holds is the
 * project as it stood before that, one whole file each, so the latch goes on at once and without a
 * flush: anything still owed to the disk is owed to a project that is no longer this window's.
 *
 * Listened for from the moment the window mounts rather than once the workspace is up, because a
 * takeover can land while the workspace is still starting, and a window that missed it would come
 * up writable over a project somebody else has. The latch outlives the startup -
 * `WorkspaceFreezeService` keeps a freeze that names this window's own project - and nothing in the
 * window lifts it afterwards (see the `taken-over` reason in `@/lib/app/writeFreeze`).
 *
 * `knownProjectPath` is the workspace's own answer once it has one. Before then the path comes from
 * the window's props, which is where the workspace gets it from too.
 */
export function watchForSessionTakeover(knownProjectPath: () => string | null): AppEventToken {
    return getInterface().workspace.onSessionTakenOver(holder => {
        const known = knownProjectPath();
        if (known) {
            stopWriting(known, holder);
            return;
        }
        void getInterface().getWindowProps<WindowAppType.Workspace>().then(props => {
            if (props.success && props.data.projectPath) {
                stopWriting(props.data.projectPath, holder);
            }
        }, error => {
            console.error("[Workspace] Could not read which project this window has after it was taken over", error);
        });
    });
}

function stopWriting(projectPath: string, holder: ProjectSessionHolder): void {
    console.warn("[Workspace] Another NarraLeaf Studio has taken this project over; nothing here is saved from now on.");
    freezeProjectWrites({ projectPath, reason: { kind: "taken-over", holder } });
}
