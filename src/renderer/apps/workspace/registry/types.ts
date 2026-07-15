import { EditorTabComponentProps, FocusContext, PanelComponentProps } from "@/lib/workspace/services/ui/types";
import { Workspace } from "@/lib/workspace/workspace";
import { ComponentType, ReactNode } from "react";
import { TranslationKey } from "@shared/i18n";
import { EditMenuRole } from "@shared/types/ipcEvents";

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
    /** i18n key; when set, it overrides `label` at render time (falls back to `label`). */
    labelKey?: TranslationKey;
    icon?: ReactNode;
    items: ActionMenuItem[];
    order?: number;
}

export interface ActionSeparator {
    /** Marker flag to identify separator items */
    separator: true;
    /** Optional sort order */
    order?: number;
}

/**
 * Convenience constant that can be inserted inside an ActionGroup.items array
 * to render a visual separator line.
 */
export const Separator: ActionSeparator = { separator: true };

export type ActionMenuItem = ActionDefinition | ActionSubmenu | ActionSeparator;

export interface ActionGroup {
    id: string;
    label: string;
    /** i18n key; when set, it overrides `label` at render time (falls back to `label`). */
    labelKey?: TranslationKey;
    icon?: ReactNode;
    /**
     * Backward-compatible flat actions. If provided and `items` is undefined,
     * the dropdown will render these as the top-level items.
     */
    actions?: (ActionDefinition | ActionSeparator)[];
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
    /** i18n key; when set, it overrides `label` at render time (falls back to `label`). */
    labelKey?: TranslationKey;
    icon?: ReactNode;
    tooltip?: string;
    /** i18n key; when set, it overrides `tooltip` at render time (falls back to `tooltip`). */
    tooltipKey?: TranslationKey;
    shortcut?: string;
    onClick: (workspace: Workspace) => void;
    order?: number;
    disabled?: boolean;
    visible?: boolean;
    /**
     * Marks the action as a toggle and carries its current state. Only consumed by the macOS
     * native menu today, where it renders as a checkbox item.
     */
    checked?: boolean;
    /**
     * Declares that this action is the focused surface's version of a standard Edit-menu
     * command. The macOS Edit menu then routes that command (复制/剪切/粘贴/删除) here instead
     * of listing the action a second time below the built-in items.
     */
    menuRole?: EditMenuRole;
    when?: (context: FocusContext) => boolean;
    badge?: string | number; // Badge text/count
    group?: string; // Group ID this action belongs to
    /** When true, shortcut may run while DOM focus is in a text field (default false). */
    allowInEditable?: boolean;
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
    focus: string | null;
}

export type EditorLayout = EditorSplit | EditorGroup;

