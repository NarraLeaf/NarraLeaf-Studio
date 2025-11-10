import { EditorTabComponentProps, FocusContext, PanelComponentProps } from "@/lib/workspace/services/ui/types";
import { Workspace } from "@/lib/workspace/workspace";
import { ComponentType, ReactNode } from "react";

/**
 * Position where a panel can be displayed
 */
export enum PanelPosition {
    Left = "left",
    Right = "right",
    Bottom = "bottom",
}

/**
 * Panel definition for sidebar/bottom panels with generic payload support
 */
export interface PanelDefinition<TPayload = any> {
    id: string;
    title: string;
    icon: ReactNode;
    position: PanelPosition;
    component: ComponentType<PanelComponentProps<TPayload>>;
    defaultVisible?: boolean;
    order?: number; // For sorting panels
    badge?: string | number;
    payload?: TPayload; // Payload data passed to the panel component
}

/**
 * Action group definition
 */
export interface ActionSubmenu {
    id: string;
    label: string;
    icon?: ReactNode;
    items: ActionMenuItem[];
    order?: number;
}

export type ActionMenuItem = ActionDefinition | ActionSubmenu;

export interface ActionGroup {
    id: string;
    label: string;
    icon?: ReactNode;
    /**
     * Backward-compatible flat actions. If provided and `items` is undefined,
     * the dropdown will render these as the top-level items.
     */
    actions?: ActionDefinition[];
    /**
     * Hierarchical menu items (actions or submenus). Takes precedence over `actions` when defined.
     */
    items?: ActionMenuItem[];
    order?: number;
}

/**
 * Action definition for toolbar actions
 */
export interface ActionDefinition {
    id: string;
    label?: string;
    icon?: ReactNode;
    tooltip?: string;
    onClick: (workspace: Workspace) => void;
    order?: number;
    disabled?: boolean;
    visible?: boolean;
    when?: (context: FocusContext) => boolean;
    badge?: string | number; // Badge text/count
    group?: string; // Group ID this action belongs to
}

/**
 * Editor tab definition with generic payload support
 */
export interface EditorTabDefinition<TPayload = any> {
    id: string;
    title: string;
    icon?: ReactNode;
    component: ComponentType<EditorTabComponentProps<TPayload>>;
    closable?: boolean;
    modified?: boolean;
    payload?: TPayload; // Payload data passed to the editor component
}

/**
 * Editor area split configuration
 */
export interface EditorSplit {
    id: string;
    direction: "horizontal" | "vertical";
    ratio: number; // 0-1, proportion of first split
    first: EditorSplit | EditorGroup;
    second: EditorSplit | EditorGroup;
}

/**
 * Editor group (tabs container)
 */
export interface EditorGroup {
    id: string;
    tabs: EditorTabDefinition<any>[];
    activeTabId: string | null;
}

export type EditorLayout = EditorSplit | EditorGroup;

