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
    /** Slider bounds and granularity; required for `SettingValueType.Slider`. */
    min?: number;
    max?: number;
    step?: number;
    /** Rendered after a Slider's live value, e.g. "%". */
    unit?: string;
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
    /** Slider bounds and granularity; required for `SettingValueType.Slider`. */
    min?: number;
    max?: number;
    step?: number;
    /** Rendered after a Slider's live value, e.g. "%". */
    unit?: string;
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
