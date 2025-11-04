import { ReactNode, FC } from "react";

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
 * Panel definition
 */
export interface PanelDefinition {
    id: string;
    title: string;
    icon: ReactNode;
    position: PanelPosition;
    component: FC<{ panelId: string }>;
    defaultVisible?: boolean;
    order?: number;
    badge?: string | number;
}

/**
 * Editor tab definition
 */
export interface EditorTab {
    id: string;
    title: string;
    icon?: ReactNode;
    component: FC<{ tabId: string }>;
    closable?: boolean;
    modified?: boolean;
    badge?: string | number;
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

