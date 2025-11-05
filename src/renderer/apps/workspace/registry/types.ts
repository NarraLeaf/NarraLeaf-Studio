import { EditorTabComponentProps, FocusContext, PanelComponentProps } from "@/lib/workspace/services/ui/types";
import { FC, ReactNode } from "react";

/**
 * Position where a panel can be displayed
 */
export enum PanelPosition {
    Left = "left",
    Right = "right",
    Bottom = "bottom",
}

/**
 * Panel definition for sidebar/bottom panels
 */
export interface PanelDefinition {
    id: string;
    title: string;
    icon: ReactNode;
    position: PanelPosition;
    component: FC<PanelComponentProps>;
    defaultVisible?: boolean;
    order?: number; // For sorting panels
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
    onClick: () => void;
    order?: number;
    disabled?: boolean;
    visible?: boolean;
    when?: (context: FocusContext) => boolean;
    badge?: string | number; // Badge text/count
    group?: string; // Group ID this action belongs to
}

/**
 * Editor tab definition
 */
export interface EditorTabDefinition {
    id: string;
    title: string;
    icon?: ReactNode;
    component: FC<EditorTabComponentProps>;
    closable?: boolean;
    modified?: boolean;
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
    tabs: EditorTabDefinition[];
    activeTabId: string | null;
}

export type EditorLayout = EditorSplit | EditorGroup;

