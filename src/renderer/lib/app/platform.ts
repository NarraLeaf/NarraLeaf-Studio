import { PlatformSystem } from "@shared/types/os";
import { getPlatformInfo } from "@/lib/renderApp";

export function isMacPlatform(): boolean {
    try {
        return getPlatformInfo().system === PlatformSystem.darwin;
    } catch {
        return false;
    }
}

export function isWindowsPlatform(): boolean {
    try {
        return getPlatformInfo().system === PlatformSystem.win32;
    } catch {
        return false;
    }
}

/**
 * What this system calls the thing a folder is about to open in.
 *
 * Read at call time rather than through a hook: the platform cannot change while the window is up,
 * and `getPlatformInfo` is a synchronous read of what the preload already handed over.
 */
export function revealInFileManagerKey():
    | "common.revealInFinder"
    | "common.revealInExplorer"
    | "common.revealInFileManager" {
    if (isMacPlatform()) {
        return "common.revealInFinder";
    }
    if (isWindowsPlatform()) {
        return "common.revealInExplorer";
    }
    return "common.revealInFileManager";
}
