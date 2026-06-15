/**
 * Workspace panel icons use `SidebarPanelDropIcon` + `WorkspaceLayout` activate*PanelForDrop callbacks.
 * Re-export hook for consumers that need the same drop protocol outside the layout shell.
 */
export { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
