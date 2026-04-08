/**
 * Shared visual tokens for workspace-wide asset drop targets (match existing shell: primary border / subtle fill).
 */
export function workspaceAssetDropTargetClass(active: boolean): string {
    if (!active) {
        return "";
    }
    return "ring-1 ring-primary/60 bg-primary/10";
}
