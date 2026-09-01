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
export type SettingPanelId = "keybindings" | "downloadSources" | "cacheInventory" | "settingsTransfer" | "softwareUpdate" | "servers" | "dictionaries" | "projectTrust";

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
     * Font only: the CSS `font-family` each preset id stands for, so the picker can draw a preset
     * row in the face it names. Absent falls back to the story editor's stacks, which is what every
     * Font row meant before there was a second one.
     */
    optionFontStacks?: Record<string, string>;
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
    /** Renders the control disabled; the row description carries the reason. See `availability`. */
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
     * Font only: the CSS `font-family` each preset id stands for, so the picker can draw a preset
     * row in the face it names. Absent falls back to the story editor's stacks, which is what every
     * Font row meant before there was a second one.
     */
    optionFontStacks?: Record<string, string>;
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
     * Whether the row exists on this machine at all, asked synchronously every time the list is
     * built. `false` removes it from the Settings window entirely - the navigation tree, the list
     * and the search all read the same filtered registry, so a hidden row cannot be reached from
     * any of them.
     *
     * Only for conditions that cannot change while Studio runs, which in practice means the host
     * platform: an author would have to move machines for the answer to differ, so nothing has to
     * re-ask it. Anything that can change under the window - a workspace opening, a dictionary
     * being installed - belongs in `availability`, which re-evaluates and leaves the row visible
     * with its reason.
     *
     * The key stays a preference regardless. `getAllAppSettings` is deliberately unfiltered, so a
     * settings file written on macOS still round-trips its `app.confirmQuit` through a Windows
     * machine instead of being dropped on the way through.
     */
    visible?: () => boolean;
    /**
     * Dynamic availability, re-evaluated on mount and whenever the Settings window regains focus
     * (the condition usually depends on other windows, e.g. "a workspace is open"; it may also be
     * fixed for the session, as the platform check on `ui.menuBar.mode` is).
     * When unavailable, the control renders disabled.
     *
     * `reasonKey` replaces the description whenever it is returned, `enabled` or not. Usually it is
     * why a control is closed; it may also be something true about a row that still works, which is
     * how the spellcheck language says that the project's language has no dictionary without taking
     * away the ability to name another one.
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

export type AppSettingCategoryKey =
    | "servers"
    | "general"
    | "appearance"
    | "editor"
    | "workspace"
    | "performance"
    | "shortcuts"
    | "versionControl"
    | "network"
    | "data";
