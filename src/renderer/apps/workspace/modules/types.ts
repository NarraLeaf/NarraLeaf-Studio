import { ComponentType, ReactNode } from "react";
import { PanelPosition } from "../registry/types";
import { FocusContext } from "@/lib/workspace/services/ui";
import { Workspace } from "@/lib/workspace/workspace";

/**
 * Base module metadata
 * Contains common fields for all module types
 */
export interface ModuleMetadata {
    /** Unique identifier for the module (should be namespaced, e.g., "narraleaf-studio:assets") */
    id: string;
    /** Display title */
    title: string;
    /** Icon component or element */
    icon?: ReactNode;
    /** Sort order (lower values appear first) */
    order?: number;
}

/**
 * Action definition for toolbar/menubar
 * Can be registered by modules to add UI actions
 */
export interface ModuleAction {
    /** Unique identifier for the action */
    id: string;
    /** Display label (for menu items) */
    label?: string;
    /** Icon component or element */
    icon?: ReactNode;
    /** Tooltip text */
    tooltip?: string;
    /** Action handler */
    onClick: (workspace: Workspace) => void;
    /** Sort order within group */
    order?: number;
    /** Whether the action is disabled */
    disabled?: boolean;
    /** Whether the action is visible */
    visible?: boolean;
    /** Badge text or count */
    badge?: string | number;
    /** When condition - if provided, action only shows when this returns true */
    when?: (context: FocusContext) => boolean;
}

/**
 * Action group definition for dropdown menus
 * Groups related actions together
 */
export interface ModuleActionGroup {
    /** Unique identifier for the group */
    id: string;
    /** Display label */
    label: string;
    /** Icon component or element */
    icon?: ReactNode;
    /** Actions in this group */
    actions: ModuleAction[];
    /** Sort order */
    order?: number;
}

/**
 * Keybinding definition
 * Allows modules to register keyboard shortcuts
 */
export interface ModuleKeybinding {
    /** Unique identifier for the keybinding */
    id: string;
    /** Key combination (e.g., "ctrl+s", "cmd+shift+p") */
    key: string;
    /** Description of what the keybinding does */
    description?: string;
    /** Keybinding handler */
    handler: (context: FocusContext) => void | Promise<void>;
    /** When condition - if provided, keybinding only active when this returns true */
    when?: (context: FocusContext) => boolean;
}

/**
 * Panel component props
 * Props passed to panel components when rendered
 */
export interface PanelComponentProps<TPayload = any> {
    /** The panel's unique ID */
    panelId: string;
    /** Optional payload data */
    payload?: TPayload;
}

/**
 * Panel module definition
 * Defines a sidebar or bottom panel
 */
export interface PanelModule<TPayload = any> {
    /** Module metadata */
    metadata: ModuleMetadata & {
        /** Panel position */
        position: PanelPosition;
        /** Whether the panel is visible by default */
        defaultVisible?: boolean;
        /** Badge text or count */
        badge?: string | number;
    };
    /** Panel component */
    component: ComponentType<PanelComponentProps<TPayload>>;
    /** Actions that should be registered when this panel is active/focused */
    actions?: ModuleAction[];
    /** Action groups that should be registered when this panel is active/focused */
    actionGroups?: ModuleActionGroup[];
    /** Keybindings that should be active when this panel is focused */
    keybindings?: ModuleKeybinding[];
    /** Optional initialization function called when module loads */
    onLoad?: () => void | Promise<void>;
    /** Optional cleanup function called when module unloads */
    onUnload?: () => void | Promise<void>;
}

/**
 * Editor tab component props
 * Props passed to editor components when rendered
 */
export interface EditorComponentProps<TPayload = any> {
    /** The editor tab's unique ID */
    tabId: string;
    /** Optional payload data */
    payload?: TPayload;
}

/**
 * Editor module definition
 * Defines an editor type that can be opened in tabs
 */
export interface EditorModule<TPayload = any> {
    /** Module metadata */
    metadata: ModuleMetadata & {
        /** Whether the editor tab can be closed */
        closable?: boolean;
        /** Whether the editor content is modified */
        modified?: boolean;
        /** Badge text or count */
        badge?: string | number;
    };
    /** Editor component */
    component: ComponentType<EditorComponentProps<TPayload>>;
    /** Actions that should be registered when this editor is active/focused */
    actions?: ModuleAction[];
    /** Action groups that should be registered when this editor is active/focused */
    actionGroups?: ModuleActionGroup[];
    /** Keybindings that should be active when this editor is focused */
    keybindings?: ModuleKeybinding[];
    /** Optional initialization function called when module loads */
    onLoad?: () => void | Promise<void>;
    /** Optional cleanup function called when module unloads */
    onUnload?: () => void | Promise<void>;
}

/**
 * Module registration result
 * Returned when a module is registered, can be used to unregister
 */
export interface ModuleRegistration {
    /** Unique identifier of the registered module */
    id: string;
    /** Unregister this module and clean up all its registered actions/keybindings */
    unregister: () => void;
}

