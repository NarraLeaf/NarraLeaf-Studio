import { ReactNode, ComponentType } from "react";

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
    icon: ReactNode;
    position: PanelPosition;
    component: ComponentType<PanelComponentProps<TPayload>>;
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
    key: string; // e.g., "ctrl+s", "cmd+shift+p"
    description?: string;
    handler: (context: FocusContext) => void | Promise<void>;
    when?: (context: FocusContext) => boolean; // Condition for when the keybinding is active
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

