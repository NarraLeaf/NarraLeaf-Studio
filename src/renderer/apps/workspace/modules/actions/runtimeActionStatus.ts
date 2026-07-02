import type { DevModeStatus } from "@shared/types/devMode";
import type { PreviewStatus } from "@shared/types/gameRuntime";

export function isDevModeRuntimeActive(status: DevModeStatus): boolean {
    return status !== "idle" && status !== "error";
}

export function isPreviewRuntimeActive(status: PreviewStatus): boolean {
    return status !== "idle" && status !== "error";
}
