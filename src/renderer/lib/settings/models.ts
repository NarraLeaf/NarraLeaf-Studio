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
    /** Numeric bounds and granularity: Slider needs them; number inputs clamp and step by them. */
    min?: number;
    max?: number;
    step?: number;
    /** Rendered after the value, e.g. "%". */
    unit?: string;
    /**
     * `SettingValueType.Action` only: what the button does. It owns its own effects — the settings
     * layer stores nothing for an Action and `key` is only an identity for it.
     */
    onInvoke?: () => Promise<void>;
    /** Action only: the button's resting label. */
    actionLabel?: string;
    /** i18n key; when set, it overrides `actionLabel` at render time. */
    actionLabelKey?: TranslationKey;
    /** Action only: the label of the second, confirming click (defaults to `common.confirm`). */
    confirmLabelKey?: TranslationKey;
    /** Action only: renders the button in the destructive variant. */
    danger?: boolean;
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

export type AppSettingCategoryKey = "general" | "appearance" | "editor" | "workspace" | "sync" | "advanced";
