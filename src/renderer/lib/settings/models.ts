import { SettingValueType, TypeofSettingSchema } from "@/lib/settings/types";
import { GlobalStateKeys } from "@shared/types/state/globalState";
import { TranslationKey } from "@shared/i18n";

/**
 * Scopes describe where a setting is stored and applied.
 */
export enum SettingScope {
    Global = "global",
}

/**
 * Panels a `SettingValueType.Custom` entry can render. Referenced by id rather than by component
 * so this module - which the workspace imports too - stays free of React: the Settings window
 * resolves the id against its own panel registry.
 */
export type SettingPanelId = "keybindings";

/**
 * Lightweight descriptor that the shared UI layer understands.
 */
export interface SettingDescriptor<T extends SettingValueType = SettingValueType> {
    id: string;
    type: T;
    label: string;
    description: string;
    defaultValue: TypeofSettingSchema<T>;
    options?: string[];
    /** Human-facing label per option value (e.g. locale code → endonym). */
    optionLabels?: Record<string, string>;
    /** Color only: the swatch each option value paints, as a CSS color. */
    optionColors?: Record<string, string>;
    /**
     * Color only: offer a full picker alongside the preset swatches, storing a `#rrggbb` hex
     * instead of an option id. Off by default — a setting whose colors are a design decision
     * should not quietly accept any value.
     */
    allowCustomColor?: boolean;
    /**
     * Color only: apply a value locally, without storing it, while the user is still dragging in
     * the picker. Nothing is persisted and no other window sees it — the commit does that. A
     * setting that can be previewed knows how to apply itself; the settings layer does not.
     */
    onPreview?: (value: string) => void;
    /** Numeric bounds and granularity: Slider needs them; number inputs clamp and step by them. */
    min?: number;
    max?: number;
    step?: number;
    /** Rendered after the value, e.g. "%". */
    unit?: string;
    /** Action only: the button's resting label. */
    actionLabel?: string;
    /** Action only: the label of the second, confirming click. */
    confirmLabel?: string;
    /** Action only: renders the button in the destructive variant. */
    danger?: boolean;
    /** Action only: invoke on the first click - for navigation-style actions with no consequence. */
    skipConfirm?: boolean;
    /** Action only: renders the button disabled (the row description carries the reason). */
    disabled?: boolean;
    /** Custom only: which panel to render in place of a control. */
    panel?: SettingPanelId;
}

/**
 * Shape of each global application setting.
 */
export interface AppSettingDefinition<T extends SettingValueType = SettingValueType> {
    key: GlobalStateKeys;
    category: AppSettingCategoryKey;
    scope: SettingScope;
    type: T;
    label: string;
    /** i18n key; when set, it overrides `label` at render time (falls back to `label`). */
    labelKey?: TranslationKey;
    description: string;
    /** i18n key; when set, it overrides `description` at render time. */
    descriptionKey?: TranslationKey;
    /** Interpolation params for `descriptionKey` (e.g. dynamic min/max ranges). */
    descriptionParams?: Record<string, string | number>;
    defaultValue: TypeofSettingSchema<T>;
    options?: string[];
    /** Human-facing label per option value (e.g. locale code → endonym). */
    optionLabels?: Record<string, string>;
    /** i18n key per option value; when set, overrides `optionLabels` at render time. */
    optionLabelKeys?: Record<string, TranslationKey>;
    /** Color only: the swatch each option value paints, as a CSS color. */
    optionColors?: Record<string, string>;
    /**
     * Color only: offer a full picker alongside the preset swatches, storing a `#rrggbb` hex
     * instead of an option id. Off by default — a setting whose colors are a design decision
     * should not quietly accept any value.
     */
    allowCustomColor?: boolean;
    /**
     * Color only: apply a value locally, without storing it, while the user is still dragging in
     * the picker. Nothing is persisted and no other window sees it — the commit does that. A
     * setting that can be previewed knows how to apply itself; the settings layer does not.
     */
    onPreview?: (value: string) => void;
    /** Numeric bounds and granularity: Slider needs them; number inputs clamp and step by them. */
    min?: number;
    max?: number;
    step?: number;
    /** Rendered after the value, e.g. "%". */
    unit?: string;
    /**
     * `SettingValueType.Action` only: what the button does. It owns its own effects - the settings
     * layer stores nothing for an Action and `key` is only an identity for it.
     */
    onInvoke?: () => Promise<void>;
    /**
     * `SettingValueType.Custom` only: which panel renders this entry. The panel owns its own
     * storage, so nothing is read or written for it here and `key` is only an identity.
     */
    panel?: SettingPanelId;
    /** Action only: the button's resting label. */
    actionLabel?: string;
    /** i18n key; when set, it overrides `actionLabel` at render time. */
    actionLabelKey?: TranslationKey;
    /** Action only: the label of the second, confirming click (defaults to `common.confirm`). */
    confirmLabelKey?: TranslationKey;
    /** Action only: renders the button in the destructive variant. */
    danger?: boolean;
    /** Action only: invoke on the first click - for navigation-style actions with no consequence. */
    skipConfirm?: boolean;
    /**
     * Action only: dynamic availability, re-evaluated on mount and whenever the Settings window
     * regains focus (the condition usually depends on other windows, e.g. "a workspace is open").
     * When unavailable, the button renders disabled and `reasonKey` replaces the description.
     */
    availability?: () => Promise<{ enabled: boolean; reasonKey?: TranslationKey }>;
}

/**
 * Metadata used for rendering grouped categories.
 */
export interface SettingCategory {
    key: string;
    label: string;
    /** i18n key; when set, it overrides `label` at render time. */
    labelKey?: TranslationKey;
    description: string;
    /** i18n key; when set, it overrides `description` at render time. */
    descriptionKey?: TranslationKey;
    order: number;
}

export type AppSettingCategoryKey = "general" | "appearance" | "editor" | "workspace" | "sync" | "plugins" | "advanced";
