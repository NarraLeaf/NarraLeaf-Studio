import { ReactNode, ComponentType } from "react";
import type { TranslationKey } from "@shared/i18n";
import type { WorkspaceContext } from "../services";

/**
 * Notification types
 */
export enum NotificationType {
    Info = "info",
    Success = "success",
    Warning = "warning",
    Error = "error",
}

/**
 * Notification severity (for different visual styles)
 */
export enum NotificationSeverity {
    Low = "low",
    Medium = "medium",
    High = "high",
}

/**
 * Notification action button
 */
export interface NotificationAction {
    label: string;
    onClick: () => void;
    primary?: boolean;
}

/**
 * Notification definition
 */
export interface Notification {
    id: string;
    type: NotificationType;
    message: string;
    detail?: string;
    severity?: NotificationSeverity;
    timeout?: number; // Auto-dismiss timeout in ms, 0 = no auto-dismiss
    actions?: NotificationAction[];
    closable?: boolean;
    onClose?: () => void;
    timestamp: number;
}

/**
 * Action bar item definition
 */
export interface ActionBarItem {
    id: string;
    label: string;
    icon?: ReactNode;
    tooltip?: string;
    onClick: () => void;
    disabled?: boolean;
    visible?: boolean;
    order?: number;
    badge?: string | number; // Badge text/count
}

/**
 * Panel position
 */
export enum PanelPosition {
    Left = "left",
    Right = "right",
    Bottom = "bottom",
}

/**
 * Base props for panel components
 */
export interface PanelComponentProps<TPayload = any> {
    panelId: string;
    payload?: TPayload;
}

/**
 * Panel definition with payload support
 */
export interface PanelDefinition<TPayload = any> {
    id: string;
    title: string;
    /** i18n key for the title; resolved reactively at render so it follows a live language switch. */
    titleKey?: TranslationKey;
    icon: ReactNode;
    /** Omitted only by rail actions, which have no panel body to render. */
    component?: ComponentType<PanelComponentProps<TPayload>>;
    position: PanelPosition;
    /**
     * Turns the rail icon into a button: clicking runs this instead of opening a panel body.
     * See the mirror of this type in `@/apps/workspace/registry/types`.
     */
    railAction?: (workspace: WorkspaceContext) => void;
    defaultVisible?: boolean;
    order?: number;
    badge?: string | number;
    payload?: TPayload; // Payload data for the panel
}

/**
 * Base props for editor tab components
 */
export interface EditorTabComponentProps<TPayload = any> {
    tabId: string;
    payload?: TPayload;
    /**
     * Whether this tab is the group's visible/focused tab. Kept-alive tabs stay mounted while
     * hidden; components use this to restore focus/scroll when shown and pause work while hidden.
     */
    active: boolean;
}

/**
 * Editor tab definition with payload support
 */
export interface EditorTab<TPayload = any> {
    id: string;
    title: string;
    icon?: ReactNode;
    component: ComponentType<EditorTabComponentProps<TPayload>>;
    closable?: boolean;
    modified?: boolean;
    badge?: string | number;
    payload?: TPayload; // Payload data for the editor
}

/**
 * Focus area types
 */
export enum FocusArea {
    LeftPanel = "left-panel",
    RightPanel = "right-panel",
    BottomPanel = "bottom-panel",
    Editor = "editor",
    /** Tab strip of an editor group; `targetId` is the `EditorGroup.id` */
    EditorTabs = "editor-tabs",
    ActionBar = "action-bar",
    Dialog = "dialog",
    None = "none",
}

/**
 * Focus context with area and target ID
 */
export interface FocusContext {
    area: FocusArea;
    targetId?: string; // Panel ID or Editor Tab ID
}

/**
 * Keybinding definition
 */
export interface Keybinding {
    id: string;
    key: string; // e.g., "mod+s" (mod = ⌘ on macOS, Ctrl elsewhere), "ctrl+tab", "cmd+shift+p"
    description?: string;
    handler: (context: FocusContext) => void | Promise<void>;
    when?: (context: FocusContext) => boolean; // Condition for when the keybinding is active
    /**
     * When true, the binding may run while DOM focus is in a text-editable control.
     * Default false: {@link KeybindingService} skips bindings while typing unless this is set.
     */
    allowInEditable?: boolean;
    /**
     * Stable identity in the declarative keybinding catalog. Registration ids are often per-tab
     * (`story-scene-editor-<tabId>-duplicate`), which would make user overrides stick to one tab
     * and duplicate rows in the settings table; the catalog id (`story.duplicate`) is what
     * overrides key on and what the settings/cheat-sheet surfaces list. Defaults to `id`.
     */
    catalogId?: string;
}

/**
 * Dialog button definition
 */
export interface DialogButton {
    label: string;
    onClick?: () => void | Promise<void>;
    primary?: boolean;
    disabled?: boolean;
}

/**
 * Dialog definition
 */
export interface Dialog {
    id: string;
    title: string;
    message?: string;
    content?: ReactNode;
    buttons?: DialogButton[];
    closable?: boolean;
    width?: string | number;
    height?: string | number;
    onClose?: () => void;
}

/**
 * Quick pick item
 */
export interface QuickPickItem<T = any> {
    id: string;
    label: string;
    description?: string;
    detail?: string;
    icon?: ReactNode;
    data?: T;
}

/**
 * Quick pick options
 */
export interface QuickPickOptions {
    title?: string;
    placeholder?: string;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    canSelectMany?: boolean;
}

/**
 * Input box options
 */
export interface InputBoxOptions {
    title?: string;
    prompt?: string;
    placeholder?: string;
    value?: string;
    password?: boolean;
    validateInput?: (value: string) => string | undefined;
}

/**
 * Progress options
 */
export interface ProgressOptions {
    title: string;
    cancellable?: boolean;
    location?: "notification" | "window";
}

/**
 * Progress reporter
 */
export interface ProgressReporter {
    report(value: { message?: string; increment?: number }): void;
}

/**
 * Status bar item alignment
 */
export enum StatusBarAlignment {
    Left = "left",
    Right = "right",
}

/**
 * Status bar item definition
 */
export interface StatusBarItem {
    id: string;
    text: string;
    tooltip?: string;
    icon?: ReactNode;
    alignment: StatusBarAlignment;
    priority?: number;
    command?: () => void;
    visible?: boolean;
    backgroundColor?: string;
    color?: string;
}

